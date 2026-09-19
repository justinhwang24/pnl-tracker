import { fmtMoney, ymd } from "../format.js";

export function renderCalendar(pnlByDate, currentMonth, countsByDate = {}) {
  const cal = document.getElementById("calendar");
  cal.innerHTML = "";
  const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
  document.getElementById("monthTitle").textContent =
    currentMonth.toLocaleDateString(undefined, {month:"long", year:"numeric"});

  const first = new Date(y,m,1);
  const mondayIndex = (first.getDay()+6)%7;
  const start = new Date(y,m,1-mondayIndex);

  for(let i=0;i<42;i++) {
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    const key = ymd(d);
    const val = pnlByDate[key];
    const cell = document.createElement("div");
    const isOther = d.getMonth()!==m;
    cell.className = "day" + (isOther ? " other" : "") +
      (val > 0 ? " heat-pos" : val < 0 ? " heat-neg" : "");
    const num = document.createElement("div");
    num.className = "date-num";
    num.textContent = d.getDate();
    cell.appendChild(num);

    const p = document.createElement("div");
    p.className = "pnl " + (val > 0 ? "pos" : val < 0 ? "neg" : "zero");
    p.textContent = val == null ? "—" : fmtMoney(val);
    cell.appendChild(p);
    if (countsByDate[key]) {
      const count = document.createElement("div");
      count.className = "trade-count";
      count.textContent = `${countsByDate[key]} ${countsByDate[key] === 1 ? 'trade' : 'trades'}`;
      cell.appendChild(count);
    }
    cal.appendChild(cell);
  }
}
