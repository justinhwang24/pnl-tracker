import { fmtMoney } from '../format.js';
import { calculateStats, accountEstimates } from '../analytics.js';

export function renderStats(trades, allTrades = trades, snapshot = null, apiImport = false, issues = {}) {
  const stats = calculateStats(trades);
  const values = {
    monthPnl: stats ? fmtMoney(stats.total) : '—',
    tradeCount: stats ? stats.count.toLocaleString() : '—',
    winRate: stats ? `${(stats.winRate * 100).toFixed(1)}%` : '—',
    averagePnl: stats?.averageReturn == null ? '—' : `${(stats.averageReturn * 100).toFixed(1)}%`,
    profitFactor: stats?.profitFactor == null ? '—' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2),
    drawdown: stats ? fmtMoney(-stats.drawdown) : '—',
  };
  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id);
    el.textContent = value;
    el.className = `value${stats ? '' : ' zero'}`;
  }
  for (const [id, value] of [['monthPnl', stats?.total], ['averagePnl', stats?.averageReturn], ['drawdown', -stats?.drawdown]]) {
    document.getElementById(id).className = `value ${value > 0 ? 'pos' : value < 0 ? 'neg' : 'zero'}`;
  }
  const estimates = accountEstimates(trades, allTrades, snapshot);
  for (const [id, value, label] of [
    ['accountReturn', estimates?.periodReturn, 'est. account return'],
    ['accountAverage', estimates?.averageReturn, 'est. account / close'],
    ['accountDrawdown', estimates?.drawdown, 'est. account drawdown'],
  ]) {
    const el = document.getElementById(id);
    el.hidden = !snapshot;
    el.textContent = value == null ? 'Estimate unavailable' : `${(value * 100).toFixed(2)}% ${label}`;
  }
  const balance = document.getElementById('balanceSummary');
  balance.hidden = !snapshot && !apiImport;
  document.getElementById('balanceUnavailable').hidden = Boolean(snapshot);
  document.getElementById('balanceUnavailable').textContent = issues.balance || 'This import has no balance snapshot. Refresh Kalshi to request one.';
  document.getElementById('marketNameWarning').hidden = !issues.markets;
  document.getElementById('marketNameWarning').textContent = issues.markets || '';
  document.getElementById('balanceValues').hidden = !snapshot;
  if (snapshot) {
    const money = value => fmtMoney(value).replace(/^\+/, '');
    document.getElementById('cashBalance').textContent = money(snapshot.cash);
    document.getElementById('positionValue').textContent = money(snapshot.positions);
    document.getElementById('accountEquity').textContent = money(snapshot.cash + snapshot.positions);
    document.getElementById('balanceUpdated').textContent = `As of ${new Date(snapshot.fetchedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  }
}
