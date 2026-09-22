import { fmtMoney, ymd } from "../format.js";
import { dateFormatter, dateInZone } from '../timezone.js';

let activeDetails, hideTimer;
function hideDetails() {
  clearTimeout(hideTimer);
  activeDetails?.classList.remove('is-open');
  activeDetails = null;
}
window.addEventListener('resize', hideDetails);
window.addEventListener('scroll', event => {
  if (!activeDetails?.contains(event.target)) hideDetails();
}, true);
document.addEventListener('pointerdown', event => {
  if (!activeDetails?.parentElement.contains(event.target)) hideDetails();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideDetails(); });

function node(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function showDetails(cell, details) {
  hideDetails();
  activeDetails = details;
  details.classList.add('is-open');
  const anchor = cell.getBoundingClientRect();
  const { width, height } = details.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - width / 2, innerWidth - width - 12));
  const below = anchor.bottom + height + 8 <= innerHeight - 12;
  const top = below ? anchor.bottom + 8 : Math.max(12, anchor.top - height - 8);
  details.style.left = `${left}px`;
  details.style.top = `${top}px`;
}

export function renderCalendar(pnlByDate, currentMonth, countsByDate = {}, { showTrades = true, rounding = true, weekStart = 1, trades = [], timeZone = 'UTC' } = {}) {
  const cal = document.getElementById("calendar");
  hideDetails();
  const today = dateInZone(Date.now(), dateFormatter(timeZone));
  cal.classList.remove('year-calendar');
  cal.innerHTML = "";
  const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
  document.getElementById("monthTitle").textContent =
    currentMonth.toLocaleDateString(undefined, {month:"long", year:"numeric"});

  const first = new Date(y,m,1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(y,m,1-offset);
  const weekdays = document.getElementById('weekdays');
  weekdays.replaceChildren();
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 0; i < 7; i++) {
    const heading = document.createElement('div');
    heading.className = 'weekday';
    heading.textContent = names[(weekStart + i) % 7];
    weekdays.appendChild(heading);
  }

  for(let i=0;i<42;i++) {
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    const key = ymd(d);
    const val = pnlByDate[key];
    const cell = document.createElement("div");
    const isOther = d.getMonth()!==m;
    cell.className = "day" + (isOther ? " other" : "") +
      (val > 0 ? " heat-pos" : val < 0 ? " heat-neg" : "");
    cell.dataset.date = key;
    if (key === today) {
      cell.classList.add('today');
      cell.setAttribute('aria-current', 'date');
    }
    const daily = trades.filter(trade => trade.date === key).sort((a, b) => a.closedAt - b.closedAt);
    if (daily.length) {
      cell.tabIndex = 0;
      const details = document.createElement('div');
      details.className = 'day-details';
      details.id = `trades-${key}`;
      details.setAttribute('role', 'tooltip');
      const summary = node('div', 'day-details-header', '');
      const heading = node('div', 'day-details-heading', '');
      heading.append(node('span', 'day-details-eyebrow', 'DAILY RECAP'), node('strong', 'day-details-date', d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })));
      const total = node('div', 'day-details-total', '');
      total.append(node('strong', val > 0 ? 'pos' : val < 0 ? 'neg' : 'zero', fmtMoney(val)), node('span', 'day-details-caption', 'Net P&L'));
      summary.append(heading, total);
      const wins = daily.filter(trade => trade.pnl > 0).length;
      details.append(summary, node('div', 'day-details-summary', `${daily.length} ${daily.length === 1 ? 'close' : 'closes'} · ${wins} ${wins === 1 ? 'winner' : 'winners'} · ${Math.round(wins / daily.length * 100)}% win rate`));
      const list = node('div', 'day-trade-list', '');
      for (const trade of daily) {
        const line = node('div', 'day-trade', '');
        const time = new Date(trade.closedAt).toLocaleTimeString(undefined, { timeZone, hour: '2-digit', minute: '2-digit' });
        const info = node('div', 'day-trade-info', '');
        info.append(node('div', 'day-trade-title', trade.title || (trade.ticker ? 'Market title unavailable' : 'Closed trade')));
        if (!trade.title && trade.ticker) info.append(node('div', 'day-trade-ticker', trade.ticker));
        const meta = node('div', 'day-trade-meta', '');
        if (trade.side) meta.append(node('span', `side-badge side-${trade.side}`, trade.side.toUpperCase()));
        meta.append(node('span', '', `${time}${trade.quantity ? ` · ${trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} contracts` : ''}${trade.closeType ? ` · ${trade.closeType === 'sale' ? 'Sold' : 'Settled'}` : ''}`));
        info.append(meta);
        const result = node('div', 'day-trade-result', '');
        result.append(node('strong', trade.pnl > 0 ? 'pos' : trade.pnl < 0 ? 'neg' : 'zero', fmtMoney(trade.pnl)));
        if (trade.cost) result.append(node('span', 'day-trade-return', `${Math.round(trade.pnl / trade.cost * 100)}% return`));
        line.append(info, result);
        list.append(line);
      }
      details.append(list);
      cell.setAttribute('aria-describedby', details.id);
      cell.append(details);
      cell.addEventListener('mouseenter', () => showDetails(cell, details));
      cell.addEventListener('focus', () => showDetails(cell, details));
      cell.addEventListener('click', () => showDetails(cell, details));
      cell.addEventListener('mouseleave', () => {
        if (document.activeElement !== cell) hideTimer = setTimeout(hideDetails, 140);
      });
      details.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      cell.addEventListener('blur', hideDetails);
      cell.addEventListener('keydown', event => { if (event.key === 'Escape') cell.blur(); });
    }
    const num = document.createElement("div");
    num.className = "date-num";
    num.textContent = d.getDate();
    cell.appendChild(num);

    const p = document.createElement("div");
    p.className = "pnl " + (val > 0 ? "pos" : val < 0 ? "neg" : "zero");
    p.textContent = val == null ? "—" : fmtMoney(val, rounding ? 0 : 2);
    if (val != null) p.title = fmtMoney(val);
    cell.appendChild(p);
    if (showTrades && countsByDate[key]) {
      const count = document.createElement("div");
      count.className = "trade-count";
      count.textContent = `${countsByDate[key]} ${countsByDate[key] === 1 ? 'trade' : 'trades'}`;
      cell.appendChild(count);
    }
    cal.appendChild(cell);
  }
}
