import { fmtMoney } from "../format.js";

export function renderTable(entries, countsByDate = {}) {
  const tbody = document.getElementById("dailyTable");
  tbody.innerHTML = "";
  entries = [...entries].sort((a,b)=>b[0].localeCompare(a[0]));
  if(!entries.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">No closed trades this month</td></tr>';
    return;
  }
  for (const [k,v] of entries) {
    const tr = document.createElement("tr");
    const dt = new Date(k+"T12:00:00");
    tr.innerHTML = `<td>${dt.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</td>
                    <td>${countsByDate[k] || 0}</td>
                    <td class="${v>0?"pos":v<0?"neg":"zero"}">${fmtMoney(v)}</td>`;
    tbody.appendChild(tr);
  }
}
