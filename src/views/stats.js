import { fmtMoney } from '../format.js';
import { calculateStats, accountEstimates, portfolioGrowth } from '../analytics.js';

export function renderStats(trades, allTrades = trades, snapshot = null, apiImport = false, issues = {}, period = {}) {
  const stats = calculateStats(trades);
  const values = {
    monthPnl: stats ? fmtMoney(stats.total) : '—',
    tradeCount: stats ? stats.count.toLocaleString() : '—',
    winRate: stats ? `${(stats.winRate * 100).toFixed(1)}%` : '—',
    profitFactor: stats?.profitFactor == null ? '—' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2),
    drawdown: stats ? fmtMoney(-stats.drawdown) : '—',
  };
  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id);
    el.textContent = value;
    el.className = `value${stats ? '' : ' zero'}`;
  }
  for (const [id, value] of [['monthPnl', stats?.total], ['drawdown', -stats?.drawdown]]) {
    document.getElementById(id).className = `value ${value > 0 ? 'pos' : value < 0 ? 'neg' : 'zero'}`;
  }
  const estimates = accountEstimates(trades, allTrades, snapshot);
  for (const [id, value, label] of [
    ['accountDrawdown', estimates?.drawdown, 'est. account drawdown'],
  ]) {
    const el = document.getElementById(id);
    el.hidden = !snapshot;
    el.textContent = value == null ? 'Estimate unavailable' : `${(value * 100).toFixed(2)}% ${label}`;
  }
  const growth = portfolioGrowth(trades, allTrades, snapshot, period.periodPrefix, period.timeZone);
  const growthEl = document.getElementById('portfolioGrowth');
  growthEl.textContent = growth ? `${(growth.rate * 100).toFixed(2)}%` : '—';
  growthEl.className = `value ${growth?.rate > 0 ? 'pos' : growth?.rate < 0 ? 'neg' : 'zero'}`;
  const basisEl = document.getElementById('portfolioGrowthBasis');
  basisEl.hidden = !snapshot;
  basisEl.textContent = growth
    ? `${fmtMoney(growth.basis).replace(/^\+/, '')} est. starting + deposits`
    : apiImport ? 'Refresh Kalshi to load funding history' : 'Funding history unavailable';
  const balance = document.getElementById('balanceSummary');
  balance.hidden = !snapshot;
  document.getElementById('balanceUnavailable').hidden = Boolean(snapshot) || !apiImport;
  document.getElementById('balanceUnavailable').textContent = issues.balance || 'This import has no balance snapshot. Refresh Kalshi to request one.';
  document.getElementById('marketNameWarning').hidden = !issues.markets;
  document.getElementById('marketNameWarning').textContent = issues.markets || '';
  document.getElementById('balanceValues').hidden = !snapshot;
  if (snapshot) {
    const money = value => fmtMoney(value).replace(/^\+/, '');
    document.getElementById('cashBalance').textContent = money(snapshot.cash);
    document.getElementById('accountEquity').textContent = money(snapshot.cash + snapshot.positions);
  }
}
