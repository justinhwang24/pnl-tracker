import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKalshiCSV } from '../src/csv.js';
import { aggregateTrades, monthlyTrades, calculateStats } from '../src/analytics.js';

const csv = rows => 'close_timestamp,realized_pnl_with_fees_dollars\n' + rows.join('\n');

test('timezone changes move closes across day, month and year boundaries', () => {
  const { trades } = parseKalshiCSV(csv(['2026-01-01T01:00:00Z,10', '2026-01-01T10:00:00Z,-4']));
  const utc = aggregateTrades(trades, 'UTC');
  const ny = aggregateTrades(trades, 'America/New_York');
  assert.deepEqual(utc.pnlByDate, { '2026-01-01': 6 });
  assert.deepEqual(ny.pnlByDate, { '2025-12-31': 10, '2026-01-01': -4 });
  assert.deepEqual(ny.countsByDate, { '2025-12-31': 1, '2026-01-01': 1 });
  assert.equal(monthlyTrades(ny.datedTrades, new Date(2025, 11, 1)).length, 1);
});

test('daylight saving changes and repeated local hours retain each close', () => {
  const { trades } = parseKalshiCSV(csv([
    '2026-03-08T06:59:00Z,1', '2026-03-08T07:01:00Z,2',
    '2026-11-01T05:30:00Z,3', '2026-11-01T06:30:00Z,4',
  ]));
  const data = aggregateTrades(trades, 'America/New_York');
  assert.deepEqual(data.countsByDate, { '2026-03-08': 2, '2026-11-01': 2 });
  assert.deepEqual(data.pnlByDate, { '2026-03-08': 3, '2026-11-01': 7 });
});

test('import preserves zero trades and reports skipped invalid rows', () => {
  const result = parseKalshiCSV(csv(['2026-01-01T12:00:00Z,0', '2026-01-01T12:00:00,2', 'garbage,3', '2026-01-01T12:00:00Z,']));
  assert.equal(result.trades.length, 1);
  assert.equal(result.skipped, 3);
  assert.throws(() => parseKalshiCSV(csv(['invalid,12'])), /no valid/);
});

test('statistics use chronological closes, including breakeven in win rate', () => {
  const trades = [{ closedAt: 4, pnl: 0 }, { closedAt: 2, pnl: -8 }, { closedAt: 1, pnl: 10 }, { closedAt: 3, pnl: -4 }];
  assert.deepEqual(calculateStats(trades), {
    total: -2, count: 4, winRate: 0.25, average: -0.5, profitFactor: 10 / 12, drawdown: 12,
  });
});

test('empty, all winning, all losing, flat, and simultaneous closes have defined statistics', () => {
  assert.equal(calculateStats([]), null);
  assert.equal(calculateStats([{ closedAt: 1, pnl: 2 }]).profitFactor, Infinity);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -2 }]).drawdown, 2);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -2 }]).profitFactor, 0);
  assert.equal(calculateStats([{ closedAt: 1, pnl: 0 }]).profitFactor, null);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -8 }, { closedAt: 1, pnl: 10 }]).drawdown, 0);
});
