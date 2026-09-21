import { fmtMoney } from "../format.js";

export function renderChart(entries, period = 'month') {
  const canvas = document.getElementById("chart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  if(!entries.length) {
    ctx.fillStyle = "#8e98a6";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`No data for this ${period}`, W/2, H/2);
    return;
  }

  let cum = 0;
  const pts = entries.map(([k,v]) => [k, cum += v]);
  const values = [0, ...pts.map(p=>p[1])];
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }

  const padL=42,padR=16,padT=16,padB=28;
  const x = i => padL + (pts.length===1 ? (W-padL-padR)/2 : i*(W-padL-padR)/(pts.length-1));
  const y = v => padT + (max-v)*(H-padT-padB)/(max-min);

  ctx.strokeStyle = "#252d38";
  ctx.lineWidth = 1;
  for(let i=0;i<4;i++) {
    const gy = padT + i*(H-padT-padB)/3;
    ctx.beginPath(); ctx.moveTo(padL,gy); ctx.lineTo(W-padR,gy); ctx.stroke();
  }

  if (min < 0 && max > 0) {
    ctx.strokeStyle="#46505d";
    ctx.beginPath(); ctx.moveTo(padL,y(0)); ctx.lineTo(W-padR,y(0)); ctx.stroke();
  }

  ctx.strokeStyle = pts[pts.length-1][1] >= 0 ? "#2fd67b" : "#ff5d68";
  ctx.lineWidth = 3;
  ctx.beginPath();
  pts.forEach((p,i)=> {
    const px=x(i), py=y(p[1]);
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  });
  ctx.stroke();

  ctx.fillStyle="#8e98a6";
  ctx.font="11px system-ui";
  ctx.textAlign="right";
  ctx.fillText(fmtMoney(max), padL-6, padT+4);
  ctx.fillText(fmtMoney(min), padL-6, H-padB+4);

  ctx.textAlign="center";
  const firstD=new Date(pts[0][0]+"T12:00:00"), lastD=new Date(pts[pts.length-1][0]+"T12:00:00");
  ctx.fillText(firstD.toLocaleDateString(undefined,{month:"short",day:"numeric"}), padL, H-7);
  ctx.fillText(lastD.toLocaleDateString(undefined,{month:"short",day:"numeric"}), W-padR, H-7);
}
