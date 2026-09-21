export const fmtMoney = (v, fractionDigits = 2) => {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toLocaleString(undefined, {minimumFractionDigits:fractionDigits, maximumFractionDigits:fractionDigits});
};
export const ymd = d => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
