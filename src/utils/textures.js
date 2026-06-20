import * as THREE from 'three';

/**
 * Creates a striped texture on canvas.
 * @param {string[]} colors - Colors of the stripes
 * @param {number} stripeCount - Total number of stripes
 * @returns {THREE.CanvasTexture} The canvas texture
 */
export function createStripedTexture(colors, stripeCount) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  const stripeWidth = 256 / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(i * stripeWidth, 0, stripeWidth, 256);
  }
  
  // Gold dividers
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 3;
  for (let i = 0; i <= stripeCount; i++) {
    ctx.beginPath();
    ctx.moveTo(i * stripeWidth, 0);
    ctx.lineTo(i * stripeWidth, 256);
    ctx.stroke();
  }
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Creates a canopy striped texture with vertical fabric shading.
 * @param {string[]} colors - Colors of the canopy stripes
 * @param {number} stripeCount - Total number of stripes
 * @returns {THREE.CanvasTexture} The canopy texture
 */
export function createCanopyTexture(colors, stripeCount) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const stripeWidth = 1024 / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(i * stripeWidth, 0, stripeWidth, 256);
  }
  // subtle vertical shading for fabric depth
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}

/**
 * Creates a platform texture with radial sunburst, rings and star studs.
 * @param {object} [config={}] - Optional configuration parameters
 * @returns {THREE.CanvasTexture} The platform texture
 */
export function createPlatformTexture(config = {}) {
  const {
    rays = 36,
    rayColors = ['rgba(247,201,72,0.85)', 'rgba(206,58,78,0.55)'],
    gradientStart = '#3f6fd1',
    gradientMiddle = '#2a4ea0',
    gradientEnd = '#1c3370',
    rings = [
      { r: 500, c: '#c0143c' }, { r: 470, c: '#e8c25a' },
      { r: 360, c: '#1565c0' }, { r: 330, c: '#f5f5f5' },
      { r: 235, c: '#c0143c' }, { r: 205, c: '#e8c25a' },
      { r: 110, c: '#11203f' },
    ],
    starCount = 24,
    starColor = '#fff4cf'
  } = config;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const C = 512;

  // Radial gradient base
  const g = ctx.createRadialGradient(C, C, 40, C, C, 512);
  g.addColorStop(0, gradientStart);
  g.addColorStop(0.55, gradientMiddle);
  g.addColorStop(1, gradientEnd);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);

  // Sunburst rays
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 1) / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(C, C);
    ctx.arc(C, C, 500, a0, a1);
    ctx.closePath();
    ctx.fillStyle = rayColors[i % rayColors.length];
    ctx.fill();
  }

  // Concentric carnival rings
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(C, C, ring.r, 0, Math.PI * 2);
    ctx.lineWidth = 14;
    ctx.strokeStyle = ring.c;
    ctx.stroke();
    // bright chrome inner edge
    ctx.beginPath();
    ctx.arc(C, C, ring.r - 8, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();
  }

  // Star studs
  ctx.fillStyle = starColor;
  for (let i = 0; i < starCount; i++) {
    const a = (i / starCount) * Math.PI * 2;
    const x = C + Math.cos(a) * 415, y = C + Math.sin(a) * 415;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const aa = a + (k / 5) * Math.PI * 2;
      ctx.lineTo(x + Math.cos(aa) * 9, y + Math.sin(aa) * 9);
      const ab = a + ((k + 0.5) / 5) * Math.PI * 2;
      ctx.lineTo(x + Math.cos(ab) * 4, y + Math.sin(ab) * 4);
    }
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}
