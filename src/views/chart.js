import { fmtMoney } from '../format.js';

const ranges = {
  '1D': { label: 'Past Day', start: end => end - 24 * 60 * 60 * 1000 },
  '1W': { label: 'Past Week', start: end => end - 7 * 24 * 60 * 60 * 1000 },
  '1M': { label: 'Past Month', start: end => shifted(end, date => date.setMonth(date.getMonth() - 1)) },
  '1Y': { label: 'Past Year', start: end => shifted(end, date => date.setFullYear(date.getFullYear() - 1)) },
  YTD: { label: 'Year to Date', start: end => new Date(new Date(end).getFullYear(), 0, 1).getTime() },
  ALL: { label: 'All time', start: () => -Infinity },
};

let selectedRange = '1D';
let sourceTrades = [];
let plotted = [];
let initialized = false;

function shifted(timestamp, change) {
  const date = new Date(timestamp);
  change(date);
  return date.getTime();
}

function setup() {
  if (initialized) return;
  initialized = true;
  const canvas = document.getElementById('chart');
  for (const button of document.querySelectorAll('[data-chart-range]')) {
    button.addEventListener('click', () => {
      selectedRange = button.dataset.chartRange;
      draw();
    });
  }
  canvas.addEventListener('pointermove', showHover);
  canvas.addEventListener('pointerleave', hideHover);
  new ResizeObserver(draw).observe(canvas);
}

export function renderChart(trades) {
  setup();
  sourceTrades = trades
    .filter(trade => Number.isFinite(trade.closedAt) && Number.isFinite(trade.pnl))
    .sort((a, b) => a.closedAt - b.closedAt);
  draw();
}

function draw() {
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const width = Math.max(320, Math.round(canvas.clientWidth || 520));
  const height = Math.max(220, Math.round(canvas.clientHeight || 260));
  const scale = window.devicePixelRatio || 1;
  if (canvas.width !== width * scale || canvas.height !== height * scale) {
    canvas.width = width * scale;
    canvas.height = height * scale;
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  hideHover();

  const end = Date.now();
  const start = ranges[selectedRange].start(end);
  const trades = sourceTrades.filter(trade => trade.closedAt >= start && trade.closedAt <= end);
  const total = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalEl = document.getElementById('chartTotal');
  totalEl.textContent = fmtMoney(total).replace(/^\+/, '');
  totalEl.className = total > 0 ? 'pos' : total < 0 ? 'neg' : 'zero';
  document.getElementById('chartPeriod').textContent = ranges[selectedRange].label;
  for (const button of document.querySelectorAll('[data-chart-range]')) {
    button.setAttribute('aria-pressed', String(button.dataset.chartRange === selectedRange));
  }

  const pad = { left: 52, right: 18, top: 18, bottom: 30 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  drawGrid(ctx, width, height, pad);
  if (!trades.length) {
    plotted = [];
    ctx.fillStyle = '#8e98a6';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`No closes in the ${ranges[selectedRange].label.toLowerCase()}`, pad.left + plotWidth / 2, pad.top + plotHeight / 2);
    return;
  }

  const latestTrade = trades.at(-1).closedAt;
  const firstTime = selectedRange === 'ALL'
    ? (trades[0].closedAt === latestTrade ? trades[0].closedAt - 24 * 60 * 60 * 1000 : trades[0].closedAt)
    : start;
  const lastTime = selectedRange === 'ALL' ? Math.max(latestTrade, firstTime + 1) : end;
  let cumulative = 0;
  const values = trades.map(trade => ({ time: trade.closedAt, value: cumulative += trade.pnl }));
  const rawValues = [0, ...values.map(point => point.value)];
  let min = Math.min(...rawValues), max = Math.max(...rawValues);
  const spread = max - min || Math.max(Math.abs(max), 1);
  min -= spread * .12;
  max += spread * .12;
  const x = time => pad.left + (time - firstTime) / (lastTime - firstTime) * plotWidth;
  const y = value => pad.top + (max - value) / (max - min) * plotHeight;
  const line = [{ x: pad.left, y: y(0), time: firstTime, value: 0 }, ...values.map(point => ({ ...point, x: x(point.time), y: y(point.value) }))];
  plotted = line.map((point, index) => ({ ...point, isOrigin: index === 0 }));

  if (min < 0 && max > 0) {
    ctx.strokeStyle = '#596575';
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(pad.left, y(0)); ctx.lineTo(width - pad.right, y(0)); ctx.stroke();
    ctx.setLineDash([]);
  }

  const color = total >= 0 ? '#2fd67b' : '#ff5d68';
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, `${color}38`);
  gradient.addColorStop(1, `${color}00`);
  ctx.beginPath();
  line.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.lineTo(line.at(-1).x, height - pad.bottom);
  ctx.lineTo(line[0].x, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  line.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = `${color}55`;
  ctx.shadowBlur = 9;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#8491a2';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'right';
  ctx.fillText(fmtMoney(max, 0), pad.left - 7, pad.top + 4);
  ctx.fillText(fmtMoney(min, 0), pad.left - 7, height - pad.bottom + 4);
  ctx.textAlign = 'left';
  ctx.fillText(formatAxisDate(firstTime), pad.left, height - 8);
  ctx.textAlign = 'right';
  ctx.fillText(formatAxisDate(lastTime), width - pad.right, height - 8);
}

function drawGrid(ctx, width, height, pad) {
  ctx.strokeStyle = '#252d3888';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = pad.top + i * (height - pad.top - pad.bottom) / 3;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
}

function formatAxisDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function showHover(event) {
  if (!plotted.length) return;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const point = plotted.reduce((nearest, candidate) => Math.abs(candidate.x - pointerX) < Math.abs(nearest.x - pointerX) ? candidate : nearest);
  draw();
  const ctx = canvas.getContext('2d');
  const scale = window.devicePixelRatio || 1;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.strokeStyle = '#7d8998';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(point.x, 18); ctx.lineTo(point.x, canvas.clientHeight - 30); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = point.value >= 0 ? '#2fd67b' : '#ff5d68';
  ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#11161d'; ctx.lineWidth = 2; ctx.stroke();

  const tooltip = document.getElementById('chartTooltip');
  tooltip.replaceChildren();
  const value = document.createElement('strong');
  value.textContent = point.isOrigin ? '$0.00' : fmtMoney(point.value);
  value.className = point.value > 0 ? 'pos' : point.value < 0 ? 'neg' : 'zero';
  const date = document.createElement('span');
  date.textContent = new Date(point.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  tooltip.append(value, date);
  tooltip.hidden = false;
  const left = Math.max(8, Math.min(point.x - tooltip.offsetWidth / 2, rect.width - tooltip.offsetWidth - 8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(8, point.y - tooltip.offsetHeight - 12)}px`;
}

function hideHover() {
  const tooltip = document.getElementById('chartTooltip');
  if (tooltip) tooltip.hidden = true;
}
