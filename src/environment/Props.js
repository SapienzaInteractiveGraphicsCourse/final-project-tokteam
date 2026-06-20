import * as THREE from 'three';
import { isNightNow } from '../lighting/DayNightCycle.js';

function makeWelcomeTexture(text = 'LUNA  PARK') {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Background — rich crimson gradient with vignette
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, '#2a0404');
  bg.addColorStop(0.5, '#8e1818');
  bg.addColorStop(1, '#2a0404');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer gold border
  ctx.strokeStyle = '#f0c060';
  ctx.lineWidth = 26;
  ctx.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);
  ctx.strokeStyle = '#7a5520';
  ctx.lineWidth = 4;
  ctx.strokeRect(58, 58, canvas.width - 116, canvas.height - 116);

  // Decorative side ornaments
  ctx.fillStyle = '#f0c060';
  for (const side of [120, canvas.width - 120]) {
    ctx.beginPath();
    ctx.arc(side, canvas.height / 2, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(side, canvas.height / 2 - 80, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(side, canvas.height / 2 + 80, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  // "WELCOME TO" subtitle
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 90px Georgia, serif';
  ctx.fillStyle = '#f8d878';
  ctx.shadowColor = '#ff8020';
  ctx.shadowBlur = 25;
  ctx.fillText('★  WELCOME TO  ★', canvas.width / 2, canvas.height / 2 - 130);

  // Main text — glowing
  ctx.font = 'bold 240px Georgia, serif';
  ctx.shadowColor = '#ffc060';
  ctx.shadowBlur = 70;
  ctx.fillStyle = '#fff5d0';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 50);

  // Crisp gold outline on main text
  ctx.shadowBlur = 0;
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffd070';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2 + 50);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildEntranceGate() {
  const group = new THREE.Group();
  group.name = 'entranceGate';

  const Z = 100;
  const halfSpan = 9;       // gate 18m wide
  const pillarH = 11.0;
  const baseH = 1.6;

  // Animation arrays
  const lanternLights = [];
  const lanterns = [];
  const uplights = [];
  const archBulbs = [];

  // ─── Materials ────────────────────────────────────────────────
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xada088, roughness: 0.92, metalness: 0.0 });
  const stoneDarkMat = new THREE.MeshStandardMaterial({ color: 0x6c5d48, roughness: 0.95, metalness: 0.0 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5e3216, roughness: 0.85, metalness: 0.05 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe6c060, roughness: 0.35, metalness: 0.8 });
  const archMat = new THREE.MeshStandardMaterial({ color: 0x8a1a1a, roughness: 0.75, metalness: 0.15 });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff2b0, emissive: 0xffd060, emissiveIntensity: 1.4, roughness: 0.3,
  });
  const neonMat = new THREE.MeshStandardMaterial({
    color: 0xff4500,
    emissive: 0xff3300,
    emissiveIntensity: 2.0,
    roughness: 0.15,
    metalness: 0.1
  });
  const signTex = makeWelcomeTexture();
  const signMat = new THREE.MeshStandardMaterial({
    map: signTex,
    emissive: 0xffffff,
    emissiveMap: signTex,
    emissiveIntensity: 1.5,
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.FrontSide, // only the entrance-facing face shows the text
  });

  // ─── Stone bases (stepped pedestals) ─────────────────────────
  for (const sx of [-1, 1]) {
    const lowerBase = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), stoneDarkMat);
    lowerBase.position.set(sx * halfSpan, 0.25, Z);
    lowerBase.castShadow = true;
    lowerBase.receiveShadow = true;
    group.add(lowerBase);

    const upperBase = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.8), stoneMat);
    upperBase.position.set(sx * halfSpan, 0.5 + 0.55, Z);
    upperBase.castShadow = true;
    upperBase.receiveShadow = true;
    group.add(upperBase);

    // Gold band on base
    const bandGeo = new THREE.BoxGeometry(1.9, 0.08, 1.9);
    const band = new THREE.Mesh(bandGeo, goldMat);
    band.position.set(sx * halfSpan, baseH - 0.06, Z);
    group.add(band);
  }

  // ─── Pillars (substantial square columns) ─────────────────────
  for (const sx of [-1, 1]) {
    const x = sx * halfSpan;

    // Main column
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.2, pillarH, 1.2), woodMat);
    col.position.set(x, baseH + pillarH / 2, Z);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);

    // Vertical gold inlay strips on column front and back
    for (const dz of [-0.61, 0.61]) {
      const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.15, pillarH - 1.2, 0.02), goldMat);
      inlay.position.set(x, baseH + pillarH / 2, Z + dz);
      group.add(inlay);
    }

    // Climbing ivy vines (foliage detailing) around the column
    let prevX = null, prevY = null, prevZ = null;
    const ivySteps = 30;
    // Simple deterministic LCG random generator for local variation
    let lcgSeed = sx * 100;
    function localRandom() {
      lcgSeed = (lcgSeed * 1664525 + 1013904223) % 4294967296;
      return lcgSeed / 4294967296;
    }

    for (let j = 0; j < ivySteps; j++) {
      const t = j / (ivySteps - 1);
      const ivyY = baseH + t * (pillarH - 1.5);
      const angle = t * Math.PI * 5.0 + sx * 0.8;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const maxVal = Math.max(Math.abs(cos), Math.abs(sin));
      
      const px = (cos / maxVal) * 0.6;
      const pz = (sin / maxVal) * 0.6;
      
      // Face normal
      let nx = 0, nz = 0;
      if (Math.abs(cos) > Math.abs(sin)) {
        nx = Math.sign(cos);
      } else {
        nz = Math.sign(sin);
      }
      
      const leafX = x + px + nx * 0.04;
      const leafZ = Z + pz + nz * 0.04;
      
      // Draw vine stem segment
      if (prevX !== null) {
        const dx = leafX - prevX;
        const dy = ivyY - prevY;
        const dz = leafZ - prevZ;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, dist, 4);
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        
        // Position at midpoint
        stem.position.set((leafX + prevX)/2, (ivyY + prevY)/2, (leafZ + prevZ)/2);
        
        // Align cylinder with direction vector
        const direction = new THREE.Vector3(dx, dy, dz).normalize();
        const alignAxis = new THREE.Vector3(0, 1, 0);
        stem.quaternion.setFromUnitVectors(alignAxis, direction);
        stem.castShadow = true;
        group.add(stem);
      }
      prevX = leafX;
      prevY = ivyY;
      prevZ = leafZ;
      
      // Leaf cluster at this node
      const clusterSize = 1 + Math.floor(localRandom() * 3); // 1 to 3 leaves per node
      for (let k = 0; k < clusterSize; k++) {
        // Vary color slightly
        const colors = [0x1a451d, 0x2e6e33, 0x3c8a41, 0x225c28];
        const color = colors[Math.floor(localRandom() * colors.length)];
        const leafMat = new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.85,
          metalness: 0.05
        });
        
        const leafScale = 0.8 + localRandom() * 0.7;
        const leafW = 0.11 * leafScale;
        const leafH = 0.28 * leafScale;
        const leafGeo = new THREE.ConeGeometry(leafW, leafH, 4);
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        
        // Offset leaf slightly from stem
        const offX = nx * 0.06 + (localRandom() - 0.5) * 0.15;
        const offY = (localRandom() - 0.5) * 0.1;
        const offZ = nz * 0.06 + (localRandom() - 0.5) * 0.15;
        
        leaf.position.set(leafX + offX, ivyY + offY, leafZ + offZ);
        
        // Point the leaf outwards and slightly up
        leaf.rotation.x = 0.5 + localRandom() * 0.4;
        leaf.rotation.y = Math.atan2(nz, nx) + (localRandom() - 0.5) * 0.5;
        leaf.rotation.z = (localRandom() - 0.5) * 0.4;
        
        leaf.castShadow = true;
        group.add(leaf);
      }
    }

    // Carved gold rings at 1/3 and 2/3 height
    for (const ry of [pillarH * 0.33, pillarH * 0.66]) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.18, 1.36), goldMat);
      ring.position.set(x, baseH + ry, Z);
      group.add(ring);
    }

    // Column capital
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.7), goldMat);
    cap.position.set(x, baseH + pillarH + 0.25, Z);
    cap.castShadow = true;
    group.add(cap);

    // Decorative finial on top of each pillar (small obelisk)
    const finialBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.8), goldMat);
    finialBase.position.set(x, baseH + pillarH + 0.65, Z);
    group.add(finialBase);
    const finialSpire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 4), goldMat);
    finialSpire.position.set(x, baseH + pillarH + 1.5, Z);
    finialSpire.rotation.y = Math.PI / 4;
    group.add(finialSpire);

    // Double-sided lanterns (Front Z+0.7, Back Z-0.7) hanging from ornate wooden/metal brackets
    for (const sz of [-1, 1]) {
      const lanternX = x + (-sx) * 0.95; // hang on interior side
      const lanternY = baseH + pillarH - 1.8;
      const lanternZ = Z + sz * 0.7;

      // Horizontal bracket beam
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1), woodMat);
      beam.position.set(x + (-sx) * 0.45, lanternY + 0.5, lanternZ);
      beam.castShadow = true;
      group.add(beam);

      // Diagonal bracket brace
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.1), woodMat);
      brace.position.set(x + (-sx) * 0.75, lanternY + 0.2, lanternZ);
      brace.rotation.z = sx * Math.PI / 4;
      brace.castShadow = true;
      group.add(brace);

      // Gold chain/rope hanging the lantern
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 6), goldMat);
      chain.position.set(lanternX, lanternY + 0.35, lanternZ);
      chain.castShadow = true;
      group.add(chain);

      // Ornate Lantern Body
      const lanternBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.16, 0.5, 12),
        new THREE.MeshStandardMaterial({
          color: 0xfff2a0,
          emissive: 0xff9800,
          emissiveIntensity: 1.5,
          roughness: 0.3,
          metalness: 0.1
        })
      );
      lanternBody.position.set(lanternX, lanternY, lanternZ);
      lanternBody.castShadow = true;
      group.add(lanternBody);
      lanterns.push(lanternBody);

      // Lantern Cap
      const lanternCap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.22, 8), goldMat);
      lanternCap.position.set(lanternX, lanternY + 0.3, lanternZ);
      lanternCap.castShadow = true;
      group.add(lanternCap);

      // Point Light inside the lantern
      const lanternLight = new THREE.PointLight(0xffa726, 0, 12, 1.8);
      lanternLight.position.set(lanternX, lanternY, lanternZ);
      group.add(lanternLight);
      lanternLights.push(lanternLight);
    }

    // Architectural Column Spotlights at the base pointing up
    const uplight = new THREE.SpotLight(0xffb74d, 0, 16, Math.PI / 5, 0.5, 1);
    uplight.position.set(x, baseH + 0.25, Z + 0.5);
    uplight.target = col;
    group.add(uplight);
    group.add(uplight.target);
    uplights.push(uplight);

    const uplightBack = new THREE.SpotLight(0xffb74d, 0, 16, Math.PI / 5, 0.5, 1);
    uplightBack.position.set(x, baseH + 0.25, Z - 0.5);
    uplightBack.target = col;
    group.add(uplightBack);
    group.add(uplightBack.target);
    uplights.push(uplightBack);
  }

  // ─── Arch (extruded curve connecting the pillars) ────────────
  const archW = halfSpan * 2 + 2.2;
  const archH = 3.4;
  const archShape = new THREE.Shape();
  archShape.moveTo(-archW / 2, 0);
  archShape.lineTo(archW / 2, 0);
  archShape.lineTo(archW / 2, archH * 0.35);
  archShape.quadraticCurveTo(0, archH * 1.55, -archW / 2, archH * 0.35);
  archShape.lineTo(-archW / 2, 0);

  const archDepth = 1.6;
  const archGeo = new THREE.ExtrudeGeometry(archShape, { depth: archDepth, bevelEnabled: false });
  const arch = new THREE.Mesh(archGeo, archMat);
  arch.position.set(0, baseH + pillarH + 0.7, Z - archDepth / 2);
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);

  // Gold trim along arch base
  const trim = new THREE.Mesh(new THREE.BoxGeometry(archW + 0.4, 0.22, archDepth + 0.2), goldMat);
  trim.position.set(0, baseH + pillarH + 0.7, Z);
  group.add(trim);

  // Central Arch Medallion (Golden Crest)
  const medallion = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.18, 16), goldMat);
  medallion.position.set(0, baseH + pillarH + 2.7, Z + archDepth / 2 + 0.08);
  medallion.rotation.x = Math.PI / 2;
  medallion.castShadow = true;
  group.add(medallion);

  // 3D Star on medallion
  const starCone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 4), goldMat);
  starCone.position.set(0, baseH + pillarH + 2.7, Z + archDepth / 2 + 0.2);
  starCone.rotation.x = Math.PI / 2;
  starCone.castShadow = true;
  group.add(starCone);

  // ─── Welcome sign — floats in front and behind the arch as a billboard ─
  const signW = archW * 0.78;
  const signH = 2.9;
  const signY = baseH + pillarH + 1.9;
  const signOffsetZ = archDepth / 2 + 0.6;  // well in front of arch so it's not buried inside it
  const signBoards = [];

  function makeSignAssembly(facingNorth) {
    const dir = facingNorth ? 1 : -1; // +Z = outside park (front), -Z = inside park (back)
    const zPos = Z + dir * signOffsetZ;

    // Each board gets its OWN segmented geometry — the cloth ripple writes the
    // vertex buffer per board, so a shared geometry would deform twice.
    const signGeo = new THREE.PlaneGeometry(signW, signH, 24, 6);

    // The board hangs from its chains: a pivot at the top edge lets it swing,
    // while per-vertex waves ripple the cloth (strongest at the free bottom edge).
    const boardPivot = new THREE.Group();
    boardPivot.position.set(0, signY + signH / 2, zPos);
    group.add(boardPivot);
    const board = new THREE.Mesh(signGeo, signMat);
    board.position.set(0, -signH / 2, 0);
    if (!facingNorth) board.rotation.y = Math.PI;
    boardPivot.add(board);
    signBoards.push({
      pivot: boardPivot,
      geo: signGeo,
      restPos: new Float32Array(signGeo.attributes.position.array),
      phase: Math.random() * Math.PI * 2,
    });

    // Gold frame around board
    const ft = 0.18, fd = 0.16;
    for (const side of [-1, 1]) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(ft, signH + ft * 2, fd), goldMat);
      v.position.set(side * (signW / 2 + ft / 2), signY, zPos);
      group.add(v);
    }
    for (const side of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(signW + ft * 2, ft, fd), goldMat);
      h.position.set(0, signY + side * (signH / 2 + ft / 2), zPos);
      group.add(h);
    }

    // Glowing neon tube border (StandardMaterial with emissive intensity animated dynamically)
    const neonGeo = new THREE.CylinderGeometry(0.04, 0.04, signW + 0.3, 8);
    const neonLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, signH + 0.3, 8), neonMat);
    neonLeft.position.set(-signW / 2 - 0.09, signY, zPos + 0.09);
    neonLeft.castShadow = true;
    group.add(neonLeft);

    const neonRight = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, signH + 0.3, 8), neonMat);
    neonRight.position.set(signW / 2 + 0.09, signY, zPos + 0.09);
    neonRight.castShadow = true;
    group.add(neonRight);

    const neonTop = new THREE.Mesh(neonGeo, neonMat);
    neonTop.position.set(0, signY + signH / 2 + 0.09, zPos + 0.09);
    neonTop.rotation.z = Math.PI / 2;
    neonTop.castShadow = true;
    group.add(neonTop);

    const neonBottom = new THREE.Mesh(neonGeo, neonMat);
    neonBottom.position.set(0, signY - signH / 2 - 0.09, zPos + 0.09);
    neonBottom.rotation.z = Math.PI / 2;
    neonBottom.castShadow = true;
    group.add(neonBottom);

    // Decorative chains hanging the sign from the arch
    for (const side of [-1, 1]) {
      const chain = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 1.4, 6),
        goldMat
      );
      chain.position.set(side * (signW / 2 - 0.6), signY + signH / 2 + 0.7, zPos);
      group.add(chain);
    }
  }

  // Only the outward-facing sign (entrance side). The inside should not show the welcome text.
  makeSignAssembly(true);

  // ─── Marquee bulbs running along underside of arch ───────────
  const bulbGeo = new THREE.SphereGeometry(0.16, 12, 10);
  const bulbCount = 13;
  for (let i = 0; i < bulbCount; i++) {
    const t = i / (bulbCount - 1);
    const lx = THREE.MathUtils.lerp(-archW / 2 + 0.6, archW / 2 - 0.6, t);

    // Front Bulbs (cloned materials for individual chasing)
    const bulbMatInstance = bulbMat.clone();
    const bulb = new THREE.Mesh(bulbGeo, bulbMatInstance);
    bulb.position.set(lx, baseH + pillarH + 0.55, Z + archDepth / 2 + 0.18);
    group.add(bulb);
    archBulbs.push(bulb);

    // Back Bulbs
    const bulbMatInstanceBack = bulbMat.clone();
    const bulbBack = new THREE.Mesh(bulbGeo, bulbMatInstanceBack);
    bulbBack.position.set(lx, baseH + pillarH + 0.55, Z - archDepth / 2 - 0.18);
    group.add(bulbBack);
    archBulbs.push(bulbBack);
  }

  // ─── Decorative flags — sit right ON the arch top ──
  const flagColors = [0xe04040, 0x40a0e0, 0xf0c040, 0x40c060, 0xb050d0];
  const archTopY = baseH + pillarH + 0.7 + archH * 0.95;
  const swayingFlags = [];
  const poleBaseY = archTopY - 0.3;  // a touch lower than before
  const poleH = 1.5;
  for (let i = -2; i <= 2; i++) {
    const px = i * 1.8;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, poleH, 8), goldMat);
    pole.position.set(px, poleBaseY + poleH / 2, Z);
    group.add(pole);

    // Gold ball cap on top of pole.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), goldMat);
    cap.position.set(px, poleBaseY + poleH, Z);
    group.add(cap);

    // Pivot at the very top of pole — flag swings from here.
    const pivot = new THREE.Group();
    pivot.position.set(px, poleBaseY + poleH - 0.05, Z);
    group.add(pivot);

    // Segmented plane so we can ripple the cloth per-vertex.
    const flagGeo = new THREE.PlaneGeometry(0.95, 0.65, 16, 5);
    const restPos = new Float32Array(flagGeo.attributes.position.array);
    const flag = new THREE.Mesh(
      flagGeo,
      new THREE.MeshStandardMaterial({
        color: flagColors[(i + 2) % flagColors.length],
        roughness: 0.85,
        side: THREE.DoubleSide,
      })
    );
    flag.position.set(0.52, -0.3, 0);
    pivot.add(flag);

    pivot.userData.flag = {
      phase: Math.random() * Math.PI * 2 + i,
      basePhase: i * 0.3,
      gustPhase: Math.random() * Math.PI * 2,
      mesh: flag,
      geo: flagGeo,
      restPos,
      width: 0.95,
    };
    swayingFlags.push(pivot);
  }

  // ─── Wind and Light animation tick ──────────────────────────────
  group.userData.tick = (delta, time, windSpeed) => {
    // 1. LIGHTS ANIMATION (Flicker, Chasing, Uplighting, Neon)
    const isNight = isNightNow(group);

    const targetLanternIntensity = isNight ? 2.5 : 0.0;
    const targetUplightIntensity = isNight ? 2.2 : 0.0;

    // Flicker lantern lights
    for (let i = 0; i < lanternLights.length; i++) {
      const l = lanternLights[i];
      const flicker = isNight ? (Math.sin(time * 18.0 + i) * 0.15 + Math.sin(time * 38.0 + i * 2.3) * 0.08) : 0;
      l.intensity = THREE.MathUtils.lerp(l.intensity, targetLanternIntensity + flicker, 0.1);
      lanterns[i].material.emissiveIntensity = l.intensity * 0.7;
    }

    // Smooth uplight activation
    for (const u of uplights) {
      u.intensity = THREE.MathUtils.lerp(u.intensity, targetUplightIntensity, 0.08);
    }

    // Neon sign pulsing
    const neonIntensity = isNight ? (1.8 + Math.sin(time * 3.5) * 0.6) : 0.0;
    neonMat.emissiveIntensity = neonIntensity;

    // Chasing marquee bulbs sequence
    for (let i = 0; i < archBulbs.length; i++) {
      const b = archBulbs[i];
      if (isNight) {
        // 3-phase chasing lights
        const step = Math.floor(time * 5.0) % 3;
        const isOn = (i % 3) === step;
        b.material.emissiveIntensity = isOn ? 3.0 : 0.25;
      } else {
        b.material.emissiveIntensity = 0.0;
      }
    }

    // 2. WIND FLAG ANIMATION
    if (!windSpeed) {
      for (const f of swayingFlags) {
        f.rotation.set(0, 0, 0);
        const d = f.userData.flag;
        d.geo.attributes.position.array.set(d.restPos);
        d.geo.attributes.position.needsUpdate = true;
      }
      for (const sb of signBoards) {
        sb.pivot.rotation.set(0, 0, 0);
        sb.geo.attributes.position.array.set(sb.restPos);
        sb.geo.attributes.position.needsUpdate = true;
      }
      return;
    }

    const baseIntensity = 1.0 - Math.exp(-windSpeed * 0.7);

    for (const f of swayingFlags) {
      const d = f.userData.flag;
      const t = time * (1.0 + windSpeed * 0.5);

      const gust = 0.65 + 0.45 * Math.sin(time * 0.7 + d.gustPhase);
      const intensity = baseIntensity * gust;

      f.rotation.y = Math.sin(t * 3.0 + d.phase) * 0.28 * intensity;
      f.rotation.z = Math.sin(t * 2.2 + d.phase + 1.0) * 0.12 * intensity;
      f.rotation.x = Math.sin(t * 1.7 + d.phase * 1.3) * 0.05 * intensity;

      const arr = d.geo.attributes.position.array;
      const rest = d.restPos;
      const width = d.width;
      const W = windSpeed;
      const amp = 0.07 * intensity;
      const k1 = 11.0 / width;
      const k2 = 6.5  / width;
      const sp1 = 5.5 * (0.5 + W * 0.3);
      const sp2 = 3.2 * (0.5 + W * 0.3);
      for (let v = 0; v < arr.length; v += 3) {
        const rx = rest[v];
        const ry = rest[v + 1];
        const distAlong = (rx + width / 2) / width;
        const clothMask = distAlong * distAlong;
        const wave =
          Math.sin(rx * k1 - t * sp1 + d.phase) * 0.6 +
          Math.sin(rx * k2 + ry * 7.0 - t * sp2) * 0.4;
        arr[v]     = rx;
        arr[v + 1] = ry;
        arr[v + 2] = wave * amp * clothMask;
      }
      d.geo.attributes.position.needsUpdate = true;
      d.geo.computeVertexNormals();
    }

    // 3. WELCOME SIGN — hangs from its chains: gentle swing + cloth ripple.
    for (const sb of signBoards) {
      const t = time * (0.8 + windSpeed * 0.4);
      sb.pivot.rotation.x = Math.sin(t * 0.9 + sb.phase) * 0.022 * baseIntensity;
      const arr = sb.geo.attributes.position.array;
      const rest = sb.restPos;
      const amp = 0.10 * baseIntensity;
      for (let v = 0; v < arr.length; v += 3) {
        const rx = rest[v], ry = rest[v + 1];
        const hang = (signH / 2 - ry) / signH;      // 0 at the chained top, 1 at the free bottom
        const wave = Math.sin(rx * 1.1 - t * 1.7 + sb.phase) * 0.6
                   + Math.sin(rx * 2.4 + ry * 1.6 - t * 2.7) * 0.4;
        arr[v] = rx;
        arr[v + 1] = ry;
        arr[v + 2] = wave * amp * hang;
      }
      sb.geo.attributes.position.needsUpdate = true;
      sb.geo.computeVertexNormals();
    }
  };

  return group;
}
