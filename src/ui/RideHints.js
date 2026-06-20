import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// In-world ride hint: a small floating billboard near each ride's control
// panel that fades in when the camera gets close, telling the player how to
// interact (click the panel, scroll for speed). Pure sprite + distance fade —
// no DOM, so it works in every camera mode including FPV approaches.
// ─────────────────────────────────────────────────────────────────────────────

function makeHintTexture(lines) {
  const W = 640, H = 180;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // rounded plate
  const r = 26;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(W, 0, W, H, r);
  ctx.arcTo(W, H, 0, H, r);
  ctx.arcTo(0, H, 0, 0, r);
  ctx.arcTo(0, 0, W, 0, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(8, 6, 18, 0.78)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#e8c25a';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(lines[0], W / 2, H * 0.32);
  ctx.font = '30px system-ui, sans-serif';
  ctx.fillStyle = '#cfe2ff';
  ctx.fillText(lines[1], W / 2, H * 0.70);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildRideHint({
  position = [0, 4.2, 0],
  lines = ['Click Panel to Turn On/Off', 'Scroll on Panel: Speed'],
} = {}) {
  const material = new THREE.SpriteMaterial({
    map: makeHintTexture(lines),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(5.76, 1.62, 1);
  sprite.position.set(position[0], position[1], position[2]);
  sprite.name = 'rideHint';

  const baseY = position[1];
  const SHOW_DIST = 38;   // fade in inside this camera distance
  const _camPos = new THREE.Vector3();
  const _myPos = new THREE.Vector3();

  sprite.userData.tick = (delta = 0.016, time, camera) => {
    sprite.getWorldPosition(_myPos);
    camera.getWorldPosition(_camPos);
    const d = _camPos.distanceTo(_myPos);
    const target = THREE.MathUtils.smoothstep(SHOW_DIST - d, 0, 12) * 0.92;
    material.opacity += (target - material.opacity) * (1 - Math.exp(-5.0 * delta));
    sprite.position.y = baseY + Math.sin(time * 1.4) * 0.08; // gentle float
  };
  return sprite;
}
