const CSS_TEXT = `
#rideHotbar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 12px 16px;
  background: rgba(12, 15, 22, 0.72);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  z-index: 6;
  pointer-events: none;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.ride-btn {
  pointer-events: auto;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 76px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
}
.ride-btn:hover {
  border-color: rgba(255, 160, 28, 0.55);
  background: rgba(255, 160, 28, 0.08);
}
.ride-btn:active { transform: scale(0.97); }
.ride-btn.is-active {
  border-color: #ffa01c;
  background: rgba(255, 160, 28, 0.18);
  box-shadow: 0 0 12px rgba(255, 160, 28, 0.45);
  color: #ffd9a8;
}
.ride-btn-icon { width: 24px; height: 24px; display: block; line-height: 0; }
.ride-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
.ride-btn[disabled]:hover { border-color: rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.04); }
@media (max-width: 480px) {
  .ride-btn { min-width: 52px; padding: 6px 8px; }
  .ride-btn-label { font-size: 10px; }
}
`;

export function buildRideHotbar({ rides, onSelect, getActiveRideId }) {
  if (!Array.isArray(rides) || rides.length === 0) return { destroy() {} };
  if (typeof onSelect !== 'function') throw new Error('buildRideHotbar: onSelect must be a function');
  if (typeof getActiveRideId !== 'function') throw new Error('buildRideHotbar: getActiveRideId must be a function');

  const styleEl = document.createElement('style');
  styleEl.id = 'rideHotbarStyles';
  styleEl.textContent = CSS_TEXT;
  document.head.appendChild(styleEl);

  const root = document.createElement('div');
  root.id = 'rideHotbar';

  const btnById = new Map();
  for (const ride of rides) {
    const btn = document.createElement('button');
    btn.className = 'ride-btn';
    btn.type = 'button';
    btn.dataset.rideId = ride.id;

    const icon = document.createElement('span');
    icon.className = 'ride-btn-icon';
    icon.innerHTML = ride.icon;
    btn.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'ride-btn-label';
    label.textContent = ride.name;
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      const isActive = getActiveRideId() === ride.id;
      onSelect(ride.id, { toggle: isActive });
    });

    root.appendChild(btn);
    btnById.set(ride.id, btn);
  }
  document.body.appendChild(root);

  let raf = 0;
  let lastActive = null;
  const sync = () => {
    const active = getActiveRideId();
    if (active === lastActive) {
      raf = requestAnimationFrame(sync);
      return;
    }
    lastActive = active;
    for (const [id, btn] of btnById) {
      btn.classList.toggle('is-active', id === active);
    }
    raf = requestAnimationFrame(sync);
  };
  raf = requestAnimationFrame(sync);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      styleEl.remove();
      root.remove();
    }
  };
}
