import { dateFormatter, dateInZone } from './timezone.js';

export function aggregateTrades(trades, timeZone) {
  const formatter = dateFormatter(timeZone);
  const pnlByDate = {};
  const countsByDate = {};
  const datedTrades = trades.map(trade => {
    const date = dateInZone(trade.closedAt, formatter);
    pnlByDate[date] = (pnlByDate[date] || 0) + trade.pnl;
    countsByDate[date] = (countsByDate[date] || 0) + 1;
    return { ...trade, date };
  });
  return { pnlByDate, countsByDate, datedTrades };
}

export function monthlyTrades(trades, month) {
  const prefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-`;
  return trades.filter(trade => trade.date.startsWith(prefix));
}

export function calculateStats(trades) {
  if (!trades.length) return null;
  let total = 0, wins = 0, grossProfit = 0, grossLoss = 0;
  let peak = 0, drawdown = 0;
  // Group simultaneous closes: CSV ordering cannot tell us their execution order.
  const byTimestamp = new Map();
  for (const { pnl, closedAt } of trades) {
    total += pnl;
    if (pnl > 0) { wins++; grossProfit += pnl; }
    if (pnl < 0) grossLoss -= pnl;
    byTimestamp.set(closedAt, (byTimestamp.get(closedAt) || 0) + pnl);
  }
  let cumulative = 0;
  for (const [, pnl] of [...byTimestamp].sort(([a], [b]) => a - b)) {
    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return {
    total, count: trades.length, winRate: wins / trades.length,
    ...returnStats(trades),
    average: total / trades.length,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : null,
    drawdown,
  };
}

function returnStats(trades) {
  if (trades.some(t => !Number.isFinite(t.cost) || t.cost <= 0 || !Number.isFinite(t.pnl / t.cost) || t.pnl / t.cost < -1)) {
    return { averageReturn: null };
  }
  // Log space avoids overflowing the product of individual growth factors.
  // A full loss contributes log(0), correctly producing a geometric return of -1.
  const meanLogGrowth = trades.reduce((sum, trade) => sum + Math.log1p(trade.pnl / trade.cost) / trades.length, 0);
  return { averageReturn: Math.expm1(meanLogGrowth) };
}

// Balance-anchored estimates: hold net funding and open-position valuation
// constant, then reverse subsequent realized P&L to infer period-start equity.
export function accountEstimates(periodTrades, allTrades, snapshot) {
  if (!periodTrades.length || !snapshot || !Number.isFinite(snapshot.cash) || !Number.isFinite(snapshot.positions)) return null;
  const first = periodTrades.reduce((earliest, trade) => Math.min(earliest, trade.closedAt), Infinity);
  if (allTrades.some(trade => trade.closedAt > snapshot.historyCutoff + 999)) return null;
  const currentEquity = snapshot.cash + snapshot.positions;
  const start = currentEquity - allTrades.filter(trade => trade.closedAt >= first).reduce((sum, trade) => sum + trade.pnl, 0);
  if (!Number.isFinite(start) || start <= 0) return null;
  const groups = new Map();
  for (const trade of periodTrades) groups.set(trade.closedAt, (groups.get(trade.closedAt) || 0) + trade.pnl);
  let equity = start, peak = start, drawdown = 0;
  for (const [, pnl] of [...groups].sort(([a], [b]) => a - b)) {
    equity += pnl;
    if (equity < 0) return null;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, (peak - equity) / peak);
  }
  return { periodReturn: equity / start - 1, drawdown, averageReturn: Math.expm1(Math.log(equity / start) / periodTrades.length) };
}
