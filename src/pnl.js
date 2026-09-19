export function newestMonth(pnlByDate) {
  const allDates = Object.keys(pnlByDate).sort();
  if (!allDates.length) return new Date();
  const d = new Date(allDates[allDates.length - 1] + "T12:00:00");
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function monthEntries(pnlByDate, currentMonth) {
  const y = currentMonth.getFullYear(), m = currentMonth.getMonth();
  return Object.entries(pnlByDate)
    .filter(([k]) => {
      const d = new Date(k + "T12:00:00");
      return d.getFullYear() === y && d.getMonth() === m;
    })
    .sort((a,b) => a[0].localeCompare(b[0]));
}
