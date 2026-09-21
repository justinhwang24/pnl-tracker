import { fmtMoney } from '../format.js';

export function renderYearCalendar(pnlByDate, countsByDate, year, { rounding = true, showTrades = true } = {}, onMonthClick) {
  document.getElementById('monthTitle').textContent = String(year);
  document.getElementById('weekdays').replaceChildren();
  const calendar = document.getElementById('calendar');
  calendar.classList.add('year-calendar');
  calendar.replaceChildren();
  for (let month = 0; month < 12; month++) {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const dates = Object.keys(pnlByDate).filter(date => date.startsWith(prefix));
    const total = dates.reduce((sum, date) => sum + pnlByDate[date], 0);
    const count = dates.reduce((sum, date) => sum + (countsByDate[date] || 0), 0);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `year-month${total > 0 ? ' heat-pos' : total < 0 ? ' heat-neg' : ''}`;
    const name = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long' });
    const label = document.createElement('span');
    label.className = 'year-month-name';
    label.textContent = name;
    const value = document.createElement('strong');
    value.className = total > 0 ? 'pos' : total < 0 ? 'neg' : 'zero';
    value.textContent = dates.length ? fmtMoney(total, rounding ? 0 : 2) : '—';
    button.append(label, value);
    if (showTrades && count) {
      const details = document.createElement('span');
      details.className = 'year-month-count';
      details.textContent = `${count} ${count === 1 ? 'trade' : 'trades'}`;
      button.append(details);
    }
    button.setAttribute('aria-label', `${name} ${year}, ${dates.length ? fmtMoney(total) : 'no closed trades'}. Open month view`);
    button.addEventListener('click', () => onMonthClick(month));
    calendar.append(button);
  }
}
