import { fmtMoney } from '../format.js';
import { calculateStats } from '../analytics.js';

export function renderStats(trades) {
  const stats = calculateStats(trades);
  const values = {
    monthPnl: stats ? fmtMoney(stats.total) : '—',
    tradeCount: stats ? stats.count.toLocaleString() : '—',
    winRate: stats ? `${(stats.winRate * 100).toFixed(1)}%` : '—',
    averagePnl: stats ? fmtMoney(stats.average) : '—',
    profitFactor: stats?.profitFactor == null ? '—' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2),
    drawdown: stats ? fmtMoney(-stats.drawdown) : '—',
  };
  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id);
    el.textContent = value;
    el.className = `value${stats ? '' : ' zero'}`;
  }
  for (const [id, value] of [['monthPnl', stats?.total], ['averagePnl', stats?.average], ['drawdown', -stats?.drawdown]]) {
    document.getElementById(id).className = `value ${value > 0 ? 'pos' : value < 0 ? 'neg' : 'zero'}`;
  }
}
