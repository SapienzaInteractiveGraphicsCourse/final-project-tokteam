import * as THREE from 'three';
import { loadObjMtl } from '../utils/loaders.js';
import { riverCenter, riverHalfWidth } from '../utils/riverConstants.js';

const TREE_MODELS = [
  'BirchTree_1', 'BirchTree_2', 'BirchTree_4',
  'CommonTree_1', 'CommonTree_2', 'CommonTree_4',
  'PineTree_1', 'PineTree_3', 'PineTree_5',
  'Willow_1', 'Willow_3',
];
const BUSH_MODELS = ['Bush_1', 'Bush_2', 'BushBerries_1'];
const DECOR_MODELS = [
  'WoodLog', 'WoodLog_Moss', 'TreeStump',
  'Flowers', 'Grass', 'Grass_2', 'Grass_Short',
  'Plant_1', 'Plant_2', 'Plant_3', 'Plant_4', 'Plant_5',
];

const BASE_URL = 'assets/models/environment/';

const BOOTH_RADIUS = 11.0; // booths are larger now → wider tree-free skirt around them
const LAMP_RADIUS = 5.5;  // larger exclusion zone to prevent tree canopies from clipping/overlapping lampposts
const BOOTHS = [[-14, 23]];
const LAMPS = [
  [-5, -25], [-5, -50], [-5, -75], [5, -25], [5, -50], [5, -75],
  [-5, 25], [-5, 50], [-5, 75], [5, 25], [5, 50], [5, 75],
];

function createSeededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function modelHeight(name) {
  if (name.includes('Pine')) return 12.0;
  if (name.includes('Birch') || name.includes('CommonTree') || name.includes('Willow')) return 10.0;
  if (name.includes('Bush')) return 1.5;
  if (name.includes('Berries')) return 1.2;
  if (name.includes('Stump')) return 0.7;
  if (name.includes('Log')) return 0.6;
  if (name.includes('Plant')) return 0.9;
  if (name.includes('Grass')) return 0.5;
  if (name.includes('Flower')) return 0.4;
  return 4.0;
}

async function loadAll(names) {
  const out = [];
  await Promise.all(
    names.map((name) =>
      loadObjMtl(`${BASE_URL}${name}.obj`, `${BASE_URL}${name}.mtl`)
        .then((m) => {
          m.name = name;
          const bbox = new THREE.Box3().setFromObject(m);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const scale = size.y > 0 ? modelHeight(name) / size.y : 1;
          m.scale.setScalar(scale);
          bbox.setFromObject(m);
          m.userData = { yOffset: -bbox.min.y };
          out.push(m);
        })
        .catch((err) => console.warn(`Vegetation: ${name} skipped: ${err.message}`))
    )
  );
  return out;
}

function inExclusionZone(x, z, blockLamps, coasterFP, trainFP, signKeepOut) {
  // Ride frontages (name marquees + control panels) — keep trees clear so they read from the path.
  if (signKeepOut) {
    for (const [sx, sz, sr] of signKeepOut) {
      if (Math.hypot(x - sx, z - sz) < sr) return true;
    }
  }

  // Paths (North-South corridor)
  if (Math.abs(x) < 5) return true;

  // River
  const dz = z - riverCenter(x);
  if (Math.abs(dz) < riverHalfWidth(x) + 3) return true;

  // Central circle plaza
  if (x * x + z * z < 15 * 15) return true;

  // Stage area (North end)
  if (Math.abs(x) < 15 && z < -65) return true;

  // South entrance plaza (around Z=100)
  if (Math.abs(x) < 12 && z > 80) return true;

  // 4 Rides + Control Panels exclusion zones (leaving space for the rides and line of sight to panels)
  const RIDES = [
    [-50, -50, 28],     // Ferris Wheel (NW)
    [-38.5, -30.2, 14], // Ferris Wheel Control Panel front area
    [40, -40, 22],      // Carousel (NE)
    [-40, 40, 25],      // Tagada (SW)
  ];
  for (const [rx, rz, rRad] of RIDES) {
    if (Math.hypot(x - rx, z - rz) < rRad) return true;
  }

  // Roller Coaster (SE) — keep trees clear of the ACTUAL track footprint (centre-line projected
  // to world XZ, supplied by the coaster build). This bans trees only near the rails/supports, so
  // trees still fill the loop's open interior and the corners — no whole-quadrant rectangle.
  if (coasterFP) {
    const pad2 = coasterFP.pad * coasterFP.pad;
    const a = coasterFP.pts;
    for (let i = 0; i < a.length; i += 2) {
      const dx = x - a[i], dz = z - a[i + 1];
      if (dx * dx + dz * dz < pad2) return true;
    }
  }

  // Train (Scenic Railway) — keep trees clear of the train tracks
  if (trainFP) {
    const pad2 = trainFP.pad * trainFP.pad;
    const a = trainFP.pts;
    for (let i = 0; i < a.length; i += 2) {
      const dx = x - a[i], dz = z - a[i + 1];
      if (dx * dx + dz * dz < pad2) return true;
    }
  }

  // Food stalls (Kiosks)
  for (const [bx, bz] of BOOTHS) {
    if (Math.hypot(x - bx, z - bz) < BOOTH_RADIUS) return true;
  }

  // Lampposts
  if (blockLamps) {
    for (const [lx, lz] of LAMPS) {
      if (Math.hypot(x - lx, z - lz) < LAMP_RADIUS) return true;
    }
  }
  return false;
}

export async function buildVegetation({ coasterFootprint = null, trainFootprint = null, signKeepOut = null } = {}) {
  const group = new THREE.Group();
  group.name = 'vegetation';

  const random = createSeededRandom(42); // Seeded random for deterministic layout

  const [trees, bushes, decor] = await Promise.all([
    loadAll(TREE_MODELS),
    loadAll(BUSH_MODELS),
    loadAll(DECOR_MODELS),
  ]);

  // Trees swayed by wind; bushes/decor stay still.
  const swayables = [];
  // Track XZ positions of trees so we can enforce spacing — prevents collisions when wind sways them.
  const treePositions = [];
  // Solid foliage footprints {x, z, r} for NPC visitor navigation (so walkers route around them).
  const obstacles = [];

  function tooCloseToTree(x, z, minDist) {
    for (const [tx, tz] of treePositions) {
      const dx = x - tx, dz = z - tz;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
  }

  function placeFrom(list, count, opts = {}) {
    const blockLamps = opts.blockLamps !== false;
    const sway = !!opts.sway;
    const minSpacing = opts.minSpacing || 0;
    let attempts = 0;
    let placed = 0;
    while (placed < count && attempts < count * 12) {
      attempts++;
      const x = (random() - 0.5) * 190;
      const z = (random() - 0.5) * 190;
      if (inExclusionZone(x, z, blockLamps, coasterFootprint, trainFootprint, signKeepOut)) continue;
      if (minSpacing > 0 && tooCloseToTree(x, z, minSpacing)) continue;
      const source = list[Math.floor(random() * list.length)];
      if (!source) continue;

      const instance = source.clone(true);
      const yaw = random() * Math.PI * 2;
      instance.rotation.y = yaw;
      const scaleVar = 0.8 + random() * 0.4;
      instance.scale.multiplyScalar(scaleVar);
      instance.position.set(x, source.userData.yOffset * scaleVar, z);
      group.add(instance);
      placed++;

      // Record a navigation footprint for solid foliage (trunks/bushes/logs), so NPC
      // visitors route around them. Flat ground-cover (grass/flowers/plants) is walkable.
      if (opts.obstacleRadius) {
        const nm = source.name || '';
        const skip = /Grass|Flower|Plant/.test(nm);
        if (!skip) obstacles.push({ x, z, r: opts.obstacleRadius * scaleVar });
      }

      if (sway) {
        instance.userData.sway = {
          yaw,
          phase: random() * Math.PI * 2,
          amp: 0.018 + random() * 0.018,
        };
        swayables.push(instance);
        treePositions.push([x, z]);
      }
    }
  }

  // Trees need spacing so wind sway doesn't make them collide.
  placeFrom(trees, 90, { blockLamps: true, sway: true, minSpacing: 6, obstacleRadius: 2.1 });
  placeFrom(bushes, 35, { blockLamps: true, obstacleRadius: 1.6 });
  placeFrom(decor, 90,  { blockLamps: false, obstacleRadius: 1.2 });

  // Expose solid-foliage footprints for the NPC visitor navigation grid.
  group.userData.obstacles = obstacles;

  // Wind animation tick. Sway amplitude saturates with wind so neighbours can't collide.
  group.userData.tick = (delta, time, windSpeed) => {
    if (!windSpeed) {
      for (const t of swayables) t.rotation.set(0, t.userData.sway.yaw, 0);
      return;
    }
    // Saturating curve: even at max windSpeed=3, effective sway factor ≤ 1.3.
    const intensity = 1.0 - Math.exp(-windSpeed * 0.6);
    for (const t of swayables) {
      const s = t.userData.sway;
      const phaseTime = time * (0.6 + windSpeed * 0.4);
      const rx = Math.sin(phaseTime * 1.7 + s.phase) * s.amp * intensity * 1.6;
      const rz = Math.cos(phaseTime * 1.3 + s.phase * 1.4) * s.amp * intensity * 1.6;
      t.rotation.set(rx, s.yaw, rz);
    }
  };

  return group;
}
