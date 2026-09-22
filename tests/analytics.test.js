import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKalshiCSV } from '../src/csv.js';
import { aggregateTrades, monthlyTrades, calculateStats, accountEstimates, portfolioGrowth } from '../src/analytics.js';

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
    total: -2, count: 4, winRate: 0.25, average: -0.5, profitFactor: 10 / 12, drawdown: 12, averageReturn: null,
  });
});

test('average trade return is arithmetic while drawdown remains in dollars', () => {
  const stats = calculateStats([{ closedAt: 1, pnl: 50, cost: 100 }, { closedAt: 2, pnl: -25, cost: 100 }]);
  assert.equal(stats.averageReturn, .125);
  assert.equal(stats.drawdown, 25);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -100, cost: 100 }]).averageReturn, -1);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -100, cost: 100 }]).drawdown, 100);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -101, cost: 100 }]).averageReturn, -1.01);
  assert.equal(calculateStats([{ closedAt: 1, pnl: 1, cost: 0 }]).averageReturn, null);
  const simultaneous = calculateStats([{ closedAt: 1, pnl: -50, cost: 100 }, { closedAt: 1, pnl: 100, cost: 100 }]);
  assert.equal(simultaneous.drawdown, 0);
  assert.equal(simultaneous.averageReturn, .25);
  const mixed = calculateStats([{ closedAt: 1, pnl: -10, cost: 10 }, { closedAt: 2, pnl: 100, cost: 200 }]);
  assert.equal(mixed.averageReturn, -.25);
  assert.equal(mixed.drawdown, 10);
});

test('empty, all winning, all losing, flat, and simultaneous closes have defined statistics', () => {
  assert.equal(calculateStats([]), null);
  assert.equal(calculateStats([{ closedAt: 1, pnl: 2 }]).profitFactor, Infinity);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -2 }]).drawdown, 2);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -2 }]).profitFactor, 0);
  assert.equal(calculateStats([{ closedAt: 1, pnl: 0 }]).profitFactor, null);
  assert.equal(calculateStats([{ closedAt: 1, pnl: -8 }, { closedAt: 1, pnl: 10 }]).drawdown, 0);
});

test('account estimates anchor historical periods to total equity, not just cash', () => {
  const trades = [{ closedAt: 1, pnl: 100 }, { closedAt: 2, pnl: -50 }, { closedAt: 3, pnl: 150 }];
  const snapshot = { cash: 700, positions: 500, historyCutoff: 4 };
  const stats = accountEstimates(trades.slice(0, 2), trades, snapshot);
  assert.ok(Math.abs(stats.periodReturn - .05) < 1e-12);
  assert.ok(Math.abs(stats.drawdown - 50 / 1100) < 1e-12);
  assert.ok(Math.abs(stats.averageReturn - (Math.sqrt(1.05) - 1)) < 1e-12);
  assert.equal(accountEstimates(trades, trades, null), null);
  assert.equal(accountEstimates(trades, trades, { ...snapshot, cash: 0, positions: 0 }), null);
  assert.equal(accountEstimates([{ closedAt: 1, pnl: -10 }], [{ closedAt: 1, pnl: -10 }], { cash: 0, positions: 0, historyCutoff: 4 }).drawdown, 1);
  assert.equal(accountEstimates(trades, [...trades, { closedAt: 2000, pnl: 2 }], snapshot), null);
  const fullLoss = [{ closedAt: 1, pnl: -100, cost: 100 }];
  const accountLoss = accountEstimates(fullLoss, fullLoss, { cash: 900, positions: 0, historyCutoff: 4 });
  assert.equal(calculateStats(fullLoss).averageReturn, -1);
  assert.ok(Math.abs(accountLoss.averageReturn + .1) < 1e-12);
  assert.equal(accountLoss.drawdown, .1);
});

test('portfolio growth adjusts its starting basis for deposits and withdrawals', () => {
  const trades = [
    { closedAt: 1, date: '2026-01-05', pnl: 20 },
    { closedAt: 2, date: '2026-02-05', pnl: 30 },
  ];
  const snapshot = {
    cash: 1150, positions: 0, historyCutoff: 3,
    cashFlows: [
      { kind: 'deposit', amount: 1000, at: Date.parse('2025-12-02T12:00:00Z') },
      { kind: 'deposit', amount: 200, at: Date.parse('2026-01-02T12:00:00Z') },
      { kind: 'withdrawal', amount: 100, at: Date.parse('2026-02-02T12:00:00Z') },
    ],
  };
  const result = portfolioGrowth(trades.slice(0, 1), trades, snapshot, '2026-01-', 'UTC');
  assert.equal(result.basis, 1200);
  assert.ok(Math.abs(result.rate - 20 / 1200) < 1e-12);
  assert.equal(portfolioGrowth(trades, trades, { ...snapshot, cashFlows: undefined }, '2026-', 'UTC'), null);
});
