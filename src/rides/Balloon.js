import * as THREE from 'three';
import { loadGLB, sanitizeMaterials } from '../utils/loaders.js';
import { eventBus } from '../utils/EventBus.js';
import { loadVisitorTemplates, makeRider, updateRider, getPassengerWorldHeight } from '../people/Passengers.js';
import { RideBase } from './RideBase.js';
import { isNightNow } from '../lighting/DayNightCycle.js';
import { createPointLight, createEmissiveBulb, nightMixLerp } from '../utils/rideUtils.js';

class BalloonController extends RideBase {
  constructor(group, balloons) {
    super(group, { running: true });
    this.balloons = balloons;
  }

  getFpvTarget() {
    // Have the Balloon controller use balloons[0] internally for FPV.
    return this.balloons[0]?.userData.fpvTarget?.getObjectByName('cameraRig') || null;
  }

  getFpvCameraPos(target, out) {
    target.getWorldPosition(out);
  }

  getFpvLookTarget(target, out) {
    const fpvTmpVec = new THREE.Vector3(0, 0, -10);
    target.localToWorld(fpvTmpVec);
    out.copy(fpvTmpVec);
  }

  getFpvUp(target, out) {
    const fpvTmpQuat = new THREE.Quaternion();
    target.parent.parent.getWorldQuaternion(fpvTmpQuat);
    out.set(0, 1, 0).applyQuaternion(fpvTmpQuat);
  }

  getFpvOffset() {
    return new THREE.Vector3(0, 0, 0);
  }

  getRiders() {
    return (this.balloons[0]?.userData.riders || []).map(r => ({ pivot: r.pivot }));
  }
}


const BALLOON_URL = 'assets/models/rides/balloon.glb';
const TARGET_HEIGHT = 48;
const PASSENGER_COUNTS = [2, 3, 3];

const BALLOON_ZONES = [
  { cx: -40, cz: 42, hw: 20, hd: 14, baseY: 42, minY: 36 },
  { cx: 42, cz: -42, hw: 14, hd: 20, baseY: 38, minY: 32 },
  { cx: 0, cz: -32, hw: 14, hd: 10, baseY: 50, minY: 44 },
];

// 2D value noise: deterministic hash + smoothstep interpolation.
// Returns values in [-1, 1], continuous in space (x,y).
function hash2D(ix, iy) {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2D(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);
  const u = smooth(fx), v = smooth(fy);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}


function buildOneBalloon(model, index) {
  const srcNode = model.getObjectByName('V1_HotAirBalloon_' + index);
  if (!srcNode) {
    console.warn('[Balloon] GLB missing sub-root V1_HotAirBalloon_' + index);
    return null;
  }

  const node = srcNode.clone(true);
  node.position.set(0, 0, 0);
  node.scale.setScalar(1);

  const bbox = new THREE.Box3().setFromObject(node);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
  node.scale.setScalar(scale);

  const scaledBbox = new THREE.Box3().setFromObject(node);
  const center = new THREE.Vector3();
  scaledBbox.getCenter(center);
  node.position.x -= center.x;
  node.position.z -= center.z;
  node.position.y -= scaledBbox.min.y;

  const basketNode = node.getObjectByName('V1_HotAirBalloon_Basket_' + index);
  if (basketNode) {
    basketNode.scale.y = 30 / TARGET_HEIGHT;
  }

  node.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const b = new THREE.Group();
  b.name = 'balloon_' + index;

  b.add(node);
  b.userData.fpvTarget = node;

  const zone = BALLOON_ZONES[index - 1];
  const baseY = zone.baseY;
  b.position.set(zone.cx, baseY, zone.cz);

  let basketLight = null;
  let burnerLight = null;
  let fairyMat = null;

  const basket = node.getObjectByName('V1_HotAirBalloon_Basket_' + index);
  if (basket) {
    const basketWorldPos = new THREE.Vector3();
    basket.getWorldPosition(basketWorldPos);
    const basketCenterLocal = new THREE.Vector3().copy(basketWorldPos);
    b.worldToLocal(basketCenterLocal);

    basket.updateWorldMatrix(true, true);
    let localTopY = -Infinity, localBottomY = Infinity;
    let localMinX = Infinity, localMaxX = -Infinity;
    let localMinZ = Infinity, localMaxZ = -Infinity;

    basket.traverse(child => {
      if (child.isMesh && child.geometry) {
        const posAttr = child.geometry.attributes.position;
        if (!posAttr) return;

        child.updateMatrixWorld(true);
        const mw = child.matrixWorld.elements;
        const tempV = new THREE.Vector3();

        for (let i = 0; i < posAttr.count; i++) {
          tempV.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));

          // Filter out the struts/burner frames (only keep the actual basket box)
          // The basket box geometry vertices are all below -110.0 in local Y
          if (tempV.y > -110.0) continue;

          tempV.applyMatrix4(child.matrixWorld);

          // Convert world coordinates to b-local coordinates
          const lx = tempV.x - b.position.x;
          const ly = tempV.y - b.position.y;
          const lz = tempV.z - b.position.z;

          if (ly > localTopY) localTopY = ly;
          if (ly < localBottomY) localBottomY = ly;
          if (lx < localMinX) localMinX = lx;
          if (lx > localMaxX) localMaxX = lx;
          if (lz < localMinZ) localMinZ = lz;
          if (lz > localMaxZ) localMaxZ = lz;
        }
      }
    });

    b.userData.basketCenterLocal = basketCenterLocal;
    b.userData.basketTopLocal = localTopY;
    b.userData.basketFloorLocal = localBottomY;
    const basketWidthX = localMaxX - localMinX;
    const basketWidthZ = localMaxZ - localMinZ;
    b.userData.basketWidthX = basketWidthX;
    b.userData.basketWidthZ = basketWidthZ;
    b.userData.cameraLocalY = (localBottomY + getPassengerWorldHeight() * 0.16) - node.position.y;

    // ── FPV camera-rig: positioned at passenger eye height inside the basket,
    //    as a child of `node` (the balloon's GLB sub-root = b.userData.fpvTarget).
    //    No Y-flip: the balloon doesn't yaw (b.rotation.y is never set in tick),
    //    so the rig's local -Z gives a stable horizontal gaze direction. The rig
    //    inherits the basket's pitch/roll oscillations (b.rotation.x and .z in tick).
    {
      const cameraRig = new THREE.Group();
      cameraRig.name = 'cameraRig';
      cameraRig.position.set(0, b.userData.cameraLocalY, 0);
      node.add(cameraRig);
      b.userData.cameraRig = cameraRig;
    }

    // ── Create warm interior basket light ──
    basketLight = new THREE.PointLight(0xffddaa, 0.0, 6.0, 1.5);
    // Position it inside the basket, slightly below the rim
    basketLight.position.set(basketCenterLocal.x, localTopY - 0.5, basketCenterLocal.z);
    basketLight.layers.set(2);
    b.add(basketLight);

    // ── Create flickering burner flame light ──
    burnerLight = new THREE.PointLight(0xff6611, 0.0, 20.0, 1.5);
    // Position it higher up where the burner flame would fire
    burnerLight.position.set(basketCenterLocal.x, localTopY + 3.5, basketCenterLocal.z);
    burnerLight.layers.set(2);
    b.add(burnerLight);

    // ── Create 4 decorative LED bars along the precise sides of the mesh ──
    fairyMat = new THREE.MeshStandardMaterial({
      color: 0xffeebb,
      emissive: 0xffeebb,
      emissiveIntensity: 0.0,
      roughness: 0.2,
      metalness: 0.8,
      toneMapped: false
    });
    
    const rimY = localTopY + 0.02; // Placed exactly on the top edge of the basket
    const barThickness = 0.06;

    const centerX = (localMaxX + localMinX) / 2;
    const centerZ = (localMaxZ + localMinZ) / 2;

    const lengthX = basketWidthX * 0.98; // Slightly shorter than full width
    const lengthZ = basketWidthZ * 0.98;

    const barGeoX = new THREE.BoxGeometry(lengthX, barThickness, barThickness);
    const barGeoZ = new THREE.BoxGeometry(barThickness, barThickness, lengthZ);

    const ledBars = [
      { geo: barGeoX, x: centerX, z: localMinZ }, // Back
      { geo: barGeoX, x: centerX, z: localMaxZ }, // Front
      { geo: barGeoZ, x: localMinX, z: centerZ }, // Left
      { geo: barGeoZ, x: localMaxX, z: centerZ }, // Right
    ];

    for (const bar of ledBars) {
      const mesh = new THREE.Mesh(bar.geo, fairyMat);
      mesh.position.set(bar.x, rimY, bar.z);
      b.add(mesh);
    }
  }

  const balloonLight = new THREE.PointLight(0xff8844, 0, 25, 1.5);
  balloonLight.position.set(0, TARGET_HEIGHT * 0.5, 0);
  b.add(balloonLight);

  let nightFactor = 0;

  // State for "random walk with heading": the balloon has a heading direction
  // and an angular velocity (ω) that vary smoothly over time.
  // It never stops; the home zone target acts only as a bias toward the centre.
  const initialAngle = (index * 2.094) % (Math.PI * 2);
  b.userData.headingX = Math.cos(initialAngle);
  b.userData.headingZ = Math.sin(initialAngle);
  b.userData.omega = 0;
  b.userData.omegaJitterTime = 0;

  eventBus.on('time-phase-change', (data) => {
    nightFactor = data.nightFactor;
  });

  b.userData.tick = (delta, time, windSpeed = 1, ease = 1.0) => {
    // Cruise speed scaled by wind: 1.5 units/s at wind=1
    const ws = 0.4 + windSpeed * 0.8;
    const speed = 1.5 * ws * ease;
    const MAX_OMEGA = 0.5; // rad/s — minimum radius of curvature = speed/MAX_OMEGA ≈ 3 units

    // Distance from the zone centre (used to bias the balloon back toward home)
    const fromCenterX = b.position.x - zone.cx;
    const fromCenterZ = b.position.z - zone.cz;
    const fromCenter = Math.hypot(fromCenterX, fromCenterZ);
    const maxR = Math.max(zone.hw, zone.hd);
    const ratio = fromCenter / maxR;

    // Periodic jitter on angular velocity to vary the heading direction
    // (~every 3–6 seconds, more frequent at higher wind)
    const jitterInterval = 4.5 / (0.5 + windSpeed * 0.6);
    if (time >= b.userData.omegaJitterTime) {
      // Apply a random impulse to change the steering direction
      b.userData.omega += (Math.random() * 2 - 1) * 0.6;
      b.userData.omegaJitterTime = time + jitterInterval * (0.7 + Math.random() * 0.6);
    }

    // Bias toward centre when beyond 65% of the zone radius:
    // if we are drifting away, steer to curve back home.
    if (ratio > 0.65 && fromCenter > 0.001) {
      const tdx = -fromCenterX / fromCenter; // direction toward centre
      const tdz = -fromCenterZ / fromCenter;
      // Dot product heading · toward_center: negative means we are moving away
      const dot = b.userData.headingX * tdx + b.userData.headingZ * tdz;
      if (dot < 0.4) {
        // Cross product (heading × toward_center) to determine left vs. right turn:
        // cross = hx*tz - hz*tx
        const cross = b.userData.headingX * tdz - b.userData.headingZ * tdx;
        // cross < 0 → steer right; cross > 0 → steer left
        const steerSign = cross > 0 ? 1 : -1;
        b.userData.omega += steerSign * 1.2 * delta;
      }
    }

    // Dampen angular velocity (prevents unbounded growth)
    b.userData.omega *= 0.94;
    // Clamp
    if (b.userData.omega > MAX_OMEGA) b.userData.omega = MAX_OMEGA;
    if (b.userData.omega < -MAX_OMEGA) b.userData.omega = -MAX_OMEGA;

    // Rotate heading by ω * delta (Euler integration step)
    const dTheta = b.userData.omega * delta;
    const cosT = Math.cos(dTheta);
    const sinT = Math.sin(dTheta);
    const newHx = b.userData.headingX * cosT - b.userData.headingZ * sinT;
    const newHz = b.userData.headingX * sinT + b.userData.headingZ * cosT;
    b.userData.headingX = newHx;
    b.userData.headingZ = newHz;

    // Advances in the direction of the heading
    b.position.x += b.userData.headingX * speed * delta;
    b.position.z += b.userData.headingZ * speed * delta;

    // Y: slow fixed oscillation + light jitter scaled by wind
    const yJitter = noise2D(time * 0.2, index * 50) * 0.5 * ws;
    b.position.y = Math.max(zone.minY, baseY + Math.sin(time * 0.3 + index) * 1.5 + yJitter);
    b.rotation.z = Math.sin(time * 0.5 + windSpeed + index) * 0.08;
    b.rotation.x = Math.sin(time * 0.4 + windSpeed * 0.7 + index) * 0.05;

    balloonLight.intensity = nightFactor * 40;

    // Update new lights
    if (basketLight) {
      basketLight.intensity = nightFactor * 6.0;
    }
    if (burnerLight) {
      // Simulate hot air balloon burner firing bursts and flickering
      // Use high frequency sine combined with slower envelope to look like random bursts
      const burst = 0.5 + 0.5 * Math.sin(time * 1.5 + index * 4.0);
      const flicker = 0.8 + 0.2 * Math.sin(time * 12.0 + index);
      const isFiring = burst > 0.4 ? 1.0 : 0.15;
      burnerLight.intensity = nightFactor * isFiring * flicker * 25.0;
    }
    if (fairyMat) {
      // Gentle twinkle effect for the basket fairy lights
      fairyMat.emissiveIntensity = nightFactor * (2.5 + 1.0 * Math.sin(time * 3.5 + index * 1.7));
    }

    const riders = b.userData.riders;
    if (riders) {
      for (let r = 0; r < riders.length; r++) {
        updateRider(riders[r], time);
      }
    }
  };

  return b;
}

export async function buildBalloon() {
  const group = new THREE.Group();
  group.name = 'balloon';

  let gltf;
  try {
    gltf = await loadGLB(BALLOON_URL);
  } catch (err) {
    console.error('[Balloon] Failed to load GLB:', err);
    // Return group fallback to prevent app crashes
    const fallbackController = new BalloonController(group, []);
    group.userData.controller = fallbackController;
    return group;
  }
  const model = gltf.scene;
  sanitizeMaterials(model);

  const totalPassengers = PASSENGER_COUNTS.reduce((a, c) => a + c, 0);
  const templates = await loadVisitorTemplates(totalPassengers);

  const RIDER_OFFSETS = {
    1: [
      { x: 0, z: 1.2 },       // south side
      { x: 0, z: -1.2 },      // north side
    ],
    2: [
      { x: 1.2, z: 0 },       // east side
      { x: 0, z: 1.2 },       // south side
      { x: -1.2, z: 0 },      // west side
    ],
    3: [
      { x: 0, z: -1.2 },      // north side
      { x: 1.2, z: 0 },       // east side
      { x: 0, z: 1.2 },       // south side
    ],
  };

  let templateIdx = 0;
  const balloons = [];
  for (let i = 1; i <= 3; i++) {
    const b = buildOneBalloon(model, i);
    if (b) {
      group.add(b);
      balloons.push(b);

      const count = PASSENGER_COUNTS[i - 1];
      const bcl = b.userData.basketCenterLocal;
      const bfl = b.userData.basketFloorLocal;
      if (!bcl || bfl == null) continue;

      const offsets = RIDER_OFFSETS[i];
      const riders = [];
      for (let j = 0; j < count; j++) {
        const tmpl = templates[templateIdx++];
        if (!tmpl) continue;
        const rider = makeRider(tmpl, getPassengerWorldHeight(), {
          pool: ['standRest', 'standWave', 'standCheer', 'standPoint', 'standLook'],
          standing: true,
          phase: Math.random() * Math.PI * 2,
        });
        const o = offsets[j];
        rider.pivot.position.set(
          bcl.x + o.x,
          bfl + 0.5,
          bcl.z + o.z
        );
        rider.fig.rotation.y = Math.atan2(o.x, o.z);
        b.add(rider.pivot);
        riders.push(rider);
      }
      b.userData.riders = riders;
    }
  }

  group.userData.rideId = 'balloon';
  group.userData.rideName = 'Hot Air Balloon';

  const controller = new BalloonController(group, balloons);

  group.userData.tick = (delta, time, wind) => {
    const ease = controller.running ? 1.0 : 0.0;
    controller.nightMix = nightMixLerp(controller.nightMix, isNightNow(group), delta, 2.2);

    for (const b of balloons) {
      if (b.userData.tick) {
        b.userData.tick(delta, time, wind, ease);
      }
    }
  };

  controller.applyBloomLayers();

  group.userData.controller = controller;
  return group;
}
