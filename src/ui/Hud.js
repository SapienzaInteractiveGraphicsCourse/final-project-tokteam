import * as THREE from 'three';

function getWindSpeed() {
  const el = document.getElementById('wind');
  return el ? parseFloat(el.value) : 1.0;
}

let lastArcHour = -1;
function drawTimeArc(hour) {
  if (Math.abs(hour - lastArcHour) < 0.02) return;
  lastArcHour = hour;
  const cv = document.getElementById('timeArc');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const cx = W / 2, cy = H - 22, R = 78;
  ctx.clearRect(0, 0, W, H);

  const isDay = hour >= 6 && hour < 18;
  const frac = isDay ? (hour - 6) / 12 : ((hour + 6) % 12) / 12;
  const a = Math.PI * (1 - frac);
  const px = cx + Math.cos(a) * R, py = cy - Math.sin(a) * R;

  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - R - 8, cy); ctx.lineTo(cx + R + 8, cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (isDay) {
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = '#ffd76a';
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const ra = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ra) * 11, Math.sin(ra) * 11);
      ctx.lineTo(Math.cos(ra) * 15, Math.sin(ra) * 15);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = '#cdd8f5';
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(5, -3, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  const label = (hour >= 5 && hour < 8) ? 'Dawn'
    : (hour >= 8 && hour < 17) ? 'Day'
    : (hour >= 17 && hour < 20) ? 'Dusk' : 'Night';
  ctx.fillStyle = 'rgba(255,235,200,0.85)';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + 17);
}

function setupTimeOfDayUI(dayNight) {
  const timeInput = document.getElementById('timeOfDay');
  const timeVal = document.getElementById('timeVal');
  if (!timeInput || !timeVal) return;

  function fmt(h) {
    const hours = Math.floor(h);
    const mins = Math.floor((h - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  timeInput.addEventListener('input', () => {
    const h = parseFloat(timeInput.value);
    timeVal.textContent = fmt(h);
    if (dayNight) dayNight.setHour(h);
    drawTimeArc(h);
  });
  timeVal.textContent = fmt(parseFloat(timeInput.value));
  drawTimeArc(parseFloat(timeInput.value));
}

export function buildHud(dayNight) {
  setupTimeOfDayUI(dayNight);
  return {
    getWindSpeed,
    drawTimeArc
  };
}
