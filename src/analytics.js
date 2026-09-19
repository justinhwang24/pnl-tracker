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
    average: total / trades.length,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : null,
    drawdown,
  };
}
