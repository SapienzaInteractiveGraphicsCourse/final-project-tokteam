import * as THREE from 'three';
import { isNightNow } from '../lighting/DayNightCycle.js';

// ─────────────────────────────────────────────────────────────────────────────
// Reusable carnival marquee sign for the rides.
//
//   makeRideSignTexture({ title, theme })  → a crisp, high-contrast CanvasTexture
//   buildRideSign({ title, theme, ... })   → a free-standing 3D marquee (posts, gold
//                                            frame, neon, a ring of chase bulbs, a glowing
//                                            crown + star finial). Returns a Group whose
//                                            userData.tick(time) animates the lights.
//
// The title is AUTO-FIT to the board width (shrunk until it fits with margins), which is
// the core readability fix — no more text overflowing or rendered too small to read.
// ─────────────────────────────────────────────────────────────────────────────

// Per-ride colour themes. Every value is a CSS colour string except the THREE-side
// hex numbers (neon / bulb / crown) used by the emissive 3D materials.
const SIGN_THEMES = {
  coaster: {
    bgInner: '#2a0f4e', bgOuter: '#0a0316', glow: '#a855f7',
    plate: 'rgba(10,3,22,0.55)', border: '#d4af37',
    textTop: '#ffffff', textMid: '#f0e0ff', textBot: '#b06bff', outline: '#1a0530',
    accent: '#22d3ee',
    neonHex: 0xb15cff, neonEmissive: 0xa855f7, bulbHex: 0xfff1c0, crownHex: 0x22d3ee,
  },
  ferris: {
    bgInner: '#0b2a5e', bgOuter: '#02060f', glow: '#38bdf8',
    plate: 'rgba(2,8,22,0.55)', border: '#e8c25a',
    textTop: '#ffffff', textMid: '#dbeeff', textBot: '#5cc4ff', outline: '#03152e',
    accent: '#ffd76a',
    neonHex: 0x5cc8ff, neonEmissive: 0x2aa8ef, bulbHex: 0xfff1c0, crownHex: 0xffd76a,
  },
  carousel: {
    bgInner: '#5e0b1e', bgOuter: '#12030a', glow: '#ff5577',
    plate: 'rgba(18,3,8,0.5)', border: '#f2cf5a',
    textTop: '#fff6da', textMid: '#ffe9a8', textBot: '#f0a93a', outline: '#3a0a12',
    accent: '#ffd76a',
    neonHex: 0xff6f91, neonEmissive: 0xe03a5e, bulbHex: 0xfff1c0, crownHex: 0xffd76a,
  },
  tagada: {
    bgInner: '#0b4e4a', bgOuter: '#04130f', glow: '#19e6c0',
    plate: 'rgba(4,18,15,0.5)', border: '#f4c430',
    textTop: '#ffffff', textMid: '#fff0c8', textBot: '#ffb43a', outline: '#06231d',
    accent: '#ff5a7a',
    neonHex: 0x1fe0c8, neonEmissive: 0x12bfa6, bulbHex: 0xfff1c0, crownHex: 0xff5a7a,
  },
  train: {
    bgInner: '#1a3a0a', bgOuter: '#0a1405', glow: '#4ade80',
    plate: 'rgba(10,20,5,0.55)', border: '#d4af37',
    textTop: '#ffffff', textMid: '#e0ffe0', textBot: '#7dd87d', outline: '#0a1f05',
    accent: '#fbbf24',
    neonHex: 0x4ade80, neonEmissive: 0x22c55e, bulbHex: 0xfff1c0, crownHex: 0xfbbf24,
  },
  gallery: {
    bgInner: '#3a1a0a', bgOuter: '#140a05', glow: '#fb923c',
    plate: 'rgba(20,10,5,0.55)', border: '#d4af37',
    textTop: '#ffffff', textMid: '#ffe0c8', textBot: '#fdba74', outline: '#1f0f05',
    accent: '#ef4444',
    neonHex: 0xfb923c, neonEmissive: 0xf97316, bulbHex: 0xfff1c0, crownHex: 0xef4444,
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeRideSignTexture({ title, subtitle = '★ LUNA PARK ★', theme, anisotropy = 8 }) {
  const W = 2048, H = 420;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const cx = W / 2, cy = H / 2;

  // 1. Background — rich radial wash, theme-tinted, dark at the edges.
  const bg = ctx.createRadialGradient(cx, cy, 60, cx, cy, W * 0.62);
  bg.addColorStop(0, theme.bgInner);
  bg.addColorStop(0.55, theme.bgOuter);
  bg.addColorStop(1, '#000000');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Faint diagonal art-deco rays radiating from centre for depth.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    ctx.fillStyle = i % 2 === 0 ? theme.glow : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, -40);
    ctx.lineTo(W, 40);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 2. Inner contrast plate behind the text (rounded), so letters always pop.
  const pad = 30;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
  ctx.fillStyle = theme.plate;
  ctx.fill();

  // 3. Double border — bright theme keyline + gold inner line.
  ctx.shadowColor = theme.glow; ctx.shadowBlur = 26;
  ctx.strokeStyle = theme.glow; ctx.lineWidth = 10;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = theme.border; ctx.lineWidth = 4;
  roundRect(ctx, pad + 14, pad + 14, W - (pad + 14) * 2, H - (pad + 14) * 2, 18); ctx.stroke();

  // Corner gold brackets.
  ctx.strokeStyle = theme.border; ctx.lineWidth = 7;
  const bl = 54, m = pad + 14;
  [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(([x, y, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * bl); ctx.lineTo(x, y); ctx.lineTo(x + dx * bl, y); ctx.stroke();
  });

  // 4. Subtitle ribbon (small, above the title).
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 38px "Trebuchet MS", "Arial", sans-serif';
  ctx.fillStyle = theme.accent;
  ctx.shadowColor = theme.accent; ctx.shadowBlur = 10;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.fillText(subtitle, cx, pad + 64);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.shadowBlur = 0;

  // 5. TITLE — auto-fit so it always fills the board cleanly and stays readable.
  const titleY = cy + 36;
  const maxW = W - 220;          // generous side margins
  const maxFont = 230;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  let font = maxFont;
  ctx.font = `900 ${font}px "Impact", "Arial Black", sans-serif`;
  let tw = ctx.measureText(title).width;
  while (tw > maxW && font > 40) {
    font -= 6;
    ctx.font = `900 ${font}px "Impact", "Arial Black", sans-serif`;
    tw = ctx.measureText(title).width;
  }

  // Outline first (thick dark), then bright metallic gradient fill on top → crisp + legible.
  const grad = ctx.createLinearGradient(0, titleY - font * 0.55, 0, titleY + font * 0.55);
  grad.addColorStop(0, theme.textTop);
  grad.addColorStop(0.5, theme.textMid);
  grad.addColorStop(1, theme.textBot);

  ctx.lineJoin = 'round';
  ctx.shadowColor = theme.glow; ctx.shadowBlur = 26;          // soft halo (kept tight)
  ctx.strokeStyle = theme.outline; ctx.lineWidth = 16;
  ctx.strokeText(title, cx, titleY);
  ctx.shadowBlur = 0;
  ctx.fillStyle = grad;
  ctx.fillText(title, cx, titleY);
  // thin bright keyline for sparkle
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
  ctx.strokeText(title, cx, titleY);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // 6. Flanking diamond ornaments next to the title.
  const orn = (ox) => {
    ctx.save(); ctx.translate(ox, titleY); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = theme.border; ctx.shadowColor = theme.border; ctx.shadowBlur = 14;
    ctx.fillRect(-13, -13, 26, 26);
    ctx.fillStyle = theme.accent; ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
  };
  orn(cx - tw / 2 - 70);
  orn(cx + tw / 2 + 70);
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// Free-standing 3D marquee sign.
export function buildRideSign({
  title,
  theme,
  boardW = 10.5,
  boardH = 2.6,
  postH = 5.4,
  anisotropy = 8,
} = {}) {
  const t = typeof theme === 'string' ? SIGN_THEMES[theme] : theme;
  const group = new THREE.Group();
  group.name = 'rideSign';

  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9b44a, roughness: 0.28, metalness: 0.92 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.4, metalness: 0.8 });
  const boardBackMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.6, metalness: 0.3 });

  const neonMat = new THREE.MeshStandardMaterial({
    color: t.neonHex, emissive: t.neonEmissive, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: t.crownHex, emissive: t.crownHex, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.2,
  });
  const starMat = new THREE.MeshStandardMaterial({
    color: 0xffe27a, emissive: 0xffd23a, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.3,
  });

  const boardCY = postH + boardH / 2 + 0.2;   // board centre height

  // ── Posts + bases ──
  const postGeo = new THREE.CylinderGeometry(0.16, 0.2, postH, 16);
  const baseGeo = new THREE.CylinderGeometry(0.5, 0.62, 0.3, 20);
  const collarGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.14, 16);
  const postX = boardW / 2 - 0.6;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, darkMetal);
    post.position.set(sx * postX, postH / 2, 0);
    post.castShadow = true; post.receiveShadow = true;
    group.add(post);

    const base = new THREE.Mesh(baseGeo, darkMetal);
    base.position.set(sx * postX, 0.15, 0); base.castShadow = true; base.receiveShadow = true;
    group.add(base);
    const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), goldMat);
    baseRing.rotation.x = Math.PI / 2; baseRing.position.set(sx * postX, 0.31, 0);
    group.add(baseRing);

    for (const cy of [0.9, postH - 0.2]) {
      const collar = new THREE.Mesh(collarGeo, goldMat);
      collar.position.set(sx * postX, cy, 0); group.add(collar);
    }
  }

  // ── Board assembly (faces +Z) ──
  const boardGroup = new THREE.Group();
  boardGroup.position.set(0, boardCY, 0);
  group.add(boardGroup);

  // Backing slab (dark metal), a touch larger than the display.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(boardW + 0.5, boardH + 0.5, 0.34), darkMetal);
  slab.castShadow = true; slab.receiveShadow = true;
  boardGroup.add(slab);
  const slabBack = new THREE.Mesh(new THREE.PlaneGeometry(boardW + 0.5, boardH + 0.5), boardBackMat);
  slabBack.position.z = -0.18; slabBack.rotation.y = Math.PI;
  boardGroup.add(slabBack);

  // Display panel with the marquee texture on the front.
  const tex = makeRideSignTexture({ title, theme: t, anisotropy });
  const panelMat = new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35,
    roughness: 0.45, metalness: 0.15,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardH), panelMat);
  panel.position.z = 0.18;
  boardGroup.add(panel);

  // Gold frame around the display (four bars).
  const fThk = 0.16, fDepth = 0.24;
  const frameH = new THREE.BoxGeometry(boardW + 0.34, fThk, fDepth);
  const frameV = new THREE.BoxGeometry(fThk, boardH + 0.34, fDepth);
  for (const sy of [-1, 1]) {
    const bar = new THREE.Mesh(frameH, goldMat); bar.position.set(0, sy * (boardH / 2 + 0.09), 0.2); boardGroup.add(bar);
  }
  for (const sx of [-1, 1]) {
    const bar = new THREE.Mesh(frameV, goldMat); bar.position.set(sx * (boardW / 2 + 0.09), 0, 0.2); boardGroup.add(bar);
  }

  // Neon tube just inside the frame (theme colour).
  const neonH = new THREE.CylinderGeometry(0.05, 0.05, boardW - 0.1, 10);
  const neonV = new THREE.CylinderGeometry(0.05, 0.05, boardH - 0.1, 10);
  const neons = [];
  for (const sy of [-1, 1]) {
    const n = new THREE.Mesh(neonH, neonMat.clone()); n.rotation.z = Math.PI / 2;
    n.position.set(0, sy * (boardH / 2 - 0.02), 0.3); boardGroup.add(n); neons.push(n);
  }
  for (const sx of [-1, 1]) {
    const n = new THREE.Mesh(neonV, neonMat.clone());
    n.position.set(sx * (boardW / 2 - 0.02), 0, 0.3); boardGroup.add(n); neons.push(n);
  }

  // ── Marquee chase bulbs ringing the outer frame ──
  const bulbs = [];
  const bulbGeo = new THREE.SphereGeometry(0.085, 10, 8);
  const halfW = boardW / 2 + 0.22, halfH = boardH / 2 + 0.22;
  const nx = Math.max(6, Math.round(boardW / 0.62));
  const ny = Math.max(2, Math.round(boardH / 0.62));
  const addBulb = (x, y) => {
    const m = new THREE.MeshStandardMaterial({ color: t.bulbHex, emissive: t.bulbHex, emissiveIntensity: 1.0, roughness: 0.3 });
    const b = new THREE.Mesh(bulbGeo, m);
    b.position.set(x, y, 0.26);
    boardGroup.add(b); bulbs.push(b);
  };
  for (let i = 0; i <= nx; i++) { const x = -halfW + (2 * halfW) * (i / nx); addBulb(x, halfH); addBulb(x, -halfH); }
  for (let j = 1; j < ny; j++) { const y = -halfH + (2 * halfH) * (j / ny); addBulb(-halfW, y); addBulb(halfW, y); }

  // ── Crown / pediment on top with a glowing star finial ──
  const crown = new THREE.Group();
  crown.position.set(0, boardH / 2 + 0.1, 0.1);
  boardGroup.add(crown);
  // stepped art-deco crown
  const crownBar = new THREE.Mesh(new THREE.BoxGeometry(boardW * 0.5, 0.34, 0.3), crownMat);
  crownBar.position.y = 0.2; crown.add(crownBar);
  const crownBar2 = new THREE.Mesh(new THREE.BoxGeometry(boardW * 0.3, 0.3, 0.3), crownMat);
  crownBar2.position.y = 0.52; crown.add(crownBar2);
  // little gold ball finials along the top of the frame
  for (let i = 0; i <= 6; i++) {
    const x = -boardW / 2 + boardW * (i / 6);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), goldMat);
    ball.position.set(x, boardH / 2 + 0.18, 0.18); boardGroup.add(ball);
  }
  // central star finial
  const finialPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), goldMat);
  finialPost.position.y = 0.85; crown.add(finialPost);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), starMat);
  star.position.y = 1.2; crown.add(star);

  // Gooseneck lamps arching over the board, shining down on it (classic marquee).
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 16, Math.PI * 0.6), darkMetal);
    arm.position.set(sx * (boardW * 0.28), boardH / 2 + 0.25, 0.5);
    arm.rotation.set(Math.PI / 2.1, 0, sx > 0 ? -0.4 : 0.4);
    boardGroup.add(arm);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 12, 1, true), darkMetal);
    hood.position.set(sx * (boardW * 0.28) + sx * 0.45, boardH / 2 + 0.28, 0.95);
    hood.rotation.x = Math.PI * 0.62; boardGroup.add(hood);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 1.4, roughness: 0.3 });
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), lampMat);
    lampBulb.position.copy(hood.position); lampBulb.position.z += 0.06; lampBulb.position.y -= 0.06;
    boardGroup.add(lampBulb); bulbs.push(lampBulb);
  }

  // ── Animation: bulb chase + neon pulse, brighter at night ──
  let nightMix = 0;
  group.userData.tick = (delta = 0.016, time = 0) => {
    const isNight = isNightNow(group);
    nightMix += ((isNight ? 1 : 0) - nightMix) * (1 - Math.exp(-2.2 * delta));
    const nf = nightMix;

    for (let i = 0; i < bulbs.length; i++) {
      const chase = 0.5 + 0.5 * Math.sin(time * 7.0 - i * 0.6);
      bulbs[i].material.emissiveIntensity = 0.5 + nf * (0.5 + chase * 2.2);
    }
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
    for (const n of neons) n.material.emissiveIntensity = 1.0 + nf * (0.8 + pulse * 1.6);
    panelMat.emissiveIntensity = 0.32 + nf * 0.5;
    star.material.emissiveIntensity = 0.8 + nf * 1.8 + Math.sin(time * 5) * 0.2;
    star.rotation.y += delta * 0.8;
    crownMat.emissiveIntensity = 0.5 + nf * 1.2;
  };

  return group;
}
