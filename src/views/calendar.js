import { fmtMoney, ymd } from "../format.js";

export function renderCalendar(pnlByDate, currentMonth, countsByDate = {}, { showTrades = true, rounding = true, weekStart = 1 } = {}) {
  const cal = document.getElementById("calendar");
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
