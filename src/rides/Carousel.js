import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { loadGLB, loadColorTexture, loadLinearTexture } from '../utils/loaders.js';
import { loadVisitorTemplates, makeRider, updateRider, getPassengerWorldHeight, positionRiderOnHip } from '../people/Passengers.js';
import { buildControlPanel } from '../ui/ControlPanel.js';
import { eventBus } from '../utils/EventBus.js';
import { Easings } from '../utils/Easings.js';
import { isNightNow } from '../lighting/DayNightCycle.js';
import { RideBase } from './RideBase.js';
import { createEmissiveBulb, createPointLight, nightMixLerp } from '../utils/rideUtils.js';
import { createStripedTexture } from '../utils/textures.js';

class CarouselController extends RideBase {
  constructor(group, rotatingAssembly, horses) {
    super(group, { running: true });
    this.rotatingAssembly = rotatingAssembly;
    this.horses = horses;
    this.angle = 0;
    this.maxSpeed = PLATFORM_OMEGA;
  }

  getFpvTarget() {
    return this.horses[0]?.cameraRig || null;
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
    target.parent.getWorldQuaternion(fpvTmpQuat);
    out.set(0, 1, 0).applyQuaternion(fpvTmpQuat);
  }

  getFpvOffset() {
    return new THREE.Vector3(0, 0, 0);
  }

  getRiders() {
    const r = this.horses[0]?.rider;
    return r ? [r] : [];
  }
}

const HORSE_MODEL_URL = 'assets/models/rides/carousel_horse.glb';

// Animation constants
const PLATFORM_OMEGA = 0.8;      // rad/s platform rotation at full speed
const HORSE_BOB_FREQ = 1.5;      // Bob cycles/s
const BOB_AMP = 0.9;            // Bob amplitude in meters
const HORSE_BASE_Y = 2.53;       // Default height on pole

export async function buildCarousel({ position = [40, 0, -40], camera, renderer, anisotropy = 8 } = {}) {
  // Load horse GLB and visitor templates in parallel
  const [gltf, visitors] = await Promise.all([
    loadGLB(HORSE_MODEL_URL),
    loadVisitorTemplates(8)
  ]);
  const rawHorse = gltf.scene;

  // Filter out kimono models which have single-skirt geometry and cannot spread their legs
  const carouselVisitors = visitors ? visitors.filter(v => !v.name.toLowerCase().includes('kimono')) : [];
  const activeVisitors = carouselVisitors.length > 0 ? carouselVisitors : visitors;

  // Configure raw model shadows
  rawHorse.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.layers.enable(2);
    }
  });

  hideEmbeddedPole(rawHorse);

  // Calculate horse bounding box and scale
  const horseBbox = new THREE.Box3().setFromObject(rawHorse);
  const horseSize = new THREE.Vector3();
  horseBbox.getSize(horseSize);
  const targetHorseY = 4.0; // target height in world units
  const horseScale = horseSize.y > 0 ? targetHorseY / horseSize.y : 1;

  // Find center of horse to offset it correctly
  const horseCenter = new THREE.Box3().setFromObject(rawHorse).getCenter(new THREE.Vector3());

  // Carousel materials
  // Platform: Painted Red Wood
  const woodColor = loadColorTexture('assets/textures/wood/color.jpg', { repeat: [2, 2], anisotropy });
  const woodNormal = loadLinearTexture('assets/textures/wood/normal.jpg', { repeat: [2, 2], anisotropy });
  const woodRough = loadLinearTexture('assets/textures/wood/roughness.jpg', { repeat: [2, 2], anisotropy });
  
  const platformMat = new THREE.MeshStandardMaterial({
    map: woodColor,
    normalMap: woodNormal,
    roughnessMap: woodRough,
    color: 0xaa2b2b, // tinted red wood
    roughness: 0.9,
    metalness: 0.1
  });

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.9,
    roughness: 0.15
  });

  const canopyStripes = createStripedTexture(['#a82c2c', '#fcfaf2'], 16);
  const canopyMat = new THREE.MeshStandardMaterial({
    map: canopyStripes,
    roughness: 0.8,
    metalness: 0.1,
    side: THREE.DoubleSide
  });

  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xdddddd,
    metalness: 0.95,
    roughness: 0.05
  });

  // ── Scene Hierarchy ──
  const group = new THREE.Group();
  group.name = 'carousel';
  group.position.set(position[0], position[1], position[2]);

  // Main rotating assembly (platform + canopy + center column + horses)
  const rotatingAssembly = new THREE.Group();
  rotatingAssembly.name = 'carousel_rotating_assembly';
  group.add(rotatingAssembly);

  // Platform: Cylinder of radius 12.0, thickness 0.6
  const platformMesh = new THREE.Mesh(new THREE.CylinderGeometry(12.0, 12.0, 0.6, 48), platformMat);
  platformMesh.position.y = 0.3; // resting on ground
  platformMesh.receiveShadow = true;
  platformMesh.castShadow = true;
  platformMesh.layers.enable(2);
  rotatingAssembly.add(platformMesh);

  // Gold platform trim
  const trimMesh = new THREE.Mesh(new THREE.CylinderGeometry(12.05, 12.05, 0.15, 48), goldMat);
  trimMesh.position.y = 0.3;
  trimMesh.layers.enable(2);
  rotatingAssembly.add(trimMesh);

  // Central column: Mirror-finished main support cylinder (radius 2.0, height 6.3) resting on platform surface, touching canopy underside
  const columnMesh = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 6.3, 24), mirrorMat);
  columnMesh.position.y = 0.6 + 3.15; // centered: bottom at y=0.6 (platform surface), top at y=6.9 (canopy rim bottom)
  columnMesh.castShadow = true;
  columnMesh.receiveShadow = true;
  columnMesh.layers.enable(2);
  rotatingAssembly.add(columnMesh);

  // Column gold moldings (decorative bands)
  const bottomBand = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.2, 24), goldMat);
  bottomBand.position.y = 0.6 + 0.1; // base of column, on platform surface
  bottomBand.layers.enable(2);
  rotatingAssembly.add(bottomBand);

  const topBand = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.2, 24), goldMat);
  topBand.position.y = 6.9 - 0.1; // top of column
  topBand.layers.enable(2);
  rotatingAssembly.add(topBand);

  // Canopy conical roof: Cone of radius 13.2, height 3.5
  const canopyMesh = new THREE.Mesh(new THREE.ConeGeometry(13.2, 3.5, 32), canopyMat);
  canopyMesh.position.y = 0.3 + 0.3 + 5.5 + 1.75 + 1.0; // 0.6 + 5.5 + 1.75 + 1.0 = 8.85
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  canopyMesh.layers.enable(2);
  rotatingAssembly.add(canopyMesh);

  // Canopy valance/rim
  const canopyRim = new THREE.Mesh(new THREE.CylinderGeometry(13.2, 13.2, 0.4, 32), goldMat);
  canopyRim.position.y = 0.3 + 0.3 + 5.5 + 1.0; // 0.6 + 5.5 + 1.0 = 7.1
  canopyRim.castShadow = true;
  canopyRim.layers.enable(2);
  rotatingAssembly.add(canopyRim);

  // ── Poles & Horses ──
  const horses = [];

  const poleRadius = 8.5; // distance from center

  // Build emissive bulbs for night lighting
  const bulbs = [];

  // Bulbs along canopy rim
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const bulb = createEmissiveBulb(0xffdd88, 0.12, 0.0);
    bulb.position.set(13.22 * Math.cos(angle), 0.3 + 0.3 + 5.5 + 1.0, 13.22 * Math.sin(angle));
    rotatingAssembly.add(bulb);
    bulbs.push(bulb);
  }

  const ridePointLights = [];
  
  // Central Pillar Light
  const centerLight = createPointLight(0xffdd88, 0, 45, 1.2);
  centerLight.position.set(0, 3.5, 0);
  centerLight.layers.set(2);
  rotatingAssembly.add(centerLight);
  ridePointLights.push(centerLight);

  // Canopy Rim Lights (reduced to 2 for performance, using light layers)
  for (let i = 0; i < 2; i++) {
    const angle = (i / 2) * Math.PI * 2;
    const pl = createPointLight(0xffdd88, 0, 45, 1.5);
    pl.position.set(13.22 * Math.cos(angle), 7.1, 13.22 * Math.sin(angle));
    pl.layers.set(2);
    rotatingAssembly.add(pl);
    ridePointLights.push(pl);
  }

  const cFestoon = [], cSeam = [], cColumn = [];
  const festoonWireMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.7, metalness: 0.3 });
  const rimR = 13.22, rimY = 0.3 + 0.3 + 5.5 + 1.0, apexY = 8.85 + 1.75; // rim y = 7.1, apex y = 10.6
  // Festoon swags drooping between the 16 rim points.
  for (let i = 0; i < 16; i++) {
    const a1 = (i / 16) * Math.PI * 2, a2 = ((i + 1) / 16) * Math.PI * 2;
    const A = new THREE.Vector3(Math.cos(a1) * rimR, rimY, Math.sin(a1) * rimR);
    const B = new THREE.Vector3(Math.cos(a2) * rimR, rimY, Math.sin(a2) * rimR);
    const segs = 5, sag = 0.9, pts = [];
    for (let k = 0; k <= segs; k++) { const t = k / segs; const p = new THREE.Vector3().lerpVectors(A, B, t); p.y -= Math.sin(Math.PI * t) * sag; pts.push(p); }
    const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs * 2, 0.02, 5, false), festoonWireMat);
    rotatingAssembly.add(wire);
    for (let k = 1; k < segs; k++) { const b = createEmissiveBulb(0xfff1c0, 0.13, 0.0); b.position.copy(pts[k]); rotatingAssembly.add(b); cFestoon.push(b); }
  }
  // Bulbs running up each of the 16 canopy gore seams (apex → rim).
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rim = new THREE.Vector3(Math.cos(a) * 13.0, rimY + 0.05, Math.sin(a) * 13.0);
    const apex = new THREE.Vector3(0, apexY, 0);
    for (const tt of [0.3, 0.55, 0.8]) { const b = createEmissiveBulb(0xfff1c0, 0.13, 0.0); b.position.copy(apex.clone().lerp(rim, tt)); rotatingAssembly.add(b); cSeam.push(b); }
  }
  // Two vertical bulb strips up the mirror column.
  for (const sideA of [0, Math.PI]) {
    for (let k = 0; k < 6; k++) { const b = createEmissiveBulb(0xfff1c0, 0.13, 0.0); b.position.set(Math.cos(sideA) * 2.06, 0.9 + k * 1.0, Math.sin(sideA) * 2.06); rotatingAssembly.add(b); cColumn.push(b); }
  }
  // Glowing gold neon band at the platform edge.
  const cNeonMat = new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffd76a, emissiveIntensity: 0, roughness: 0.3 });
  const platNeon = new THREE.Mesh(new THREE.TorusGeometry(12.1, 0.08, 10, 80), cNeonMat);
  platNeon.rotation.x = Math.PI / 2; platNeon.position.y = 0.42;
  rotatingAssembly.add(platNeon);
  // Warm real light filling the canopy underside at night (pure ambiance, not recoloured).
  const carouselCanopyLight = createPointLight(0xffd9a0, 0, 30, 2.0);
  carouselCanopyLight.position.set(0, 6.4, 0);
  carouselCanopyLight.layers.set(2);
  rotatingAssembly.add(carouselCanopyLight);

  const mainColor = new THREE.Color(0xffdd88);
  const warmColor = new THREE.Color(0xfff1c0);

  // Model offset rotation: Sketchfab GLB horses are facing -X, so we add Math.PI * 0.5 to rotate them forward (tangential)
  const MODEL_ROTATION_OFFSET = Math.PI * 0.5;

  for (let i = 0; i < 8; i++) {
    const angle = i * (Math.PI / 4);

    // Group for pole and horse to sit in, positioned on platform
    const mountGroup = new THREE.Group();
    mountGroup.name = `mount_group_${i}`;
    mountGroup.position.set(poleRadius * Math.cos(angle), 0.6, poleRadius * Math.sin(angle));
    
    // Rotate mount to orient horse tangentially
    mountGroup.rotation.y = -angle + MODEL_ROTATION_OFFSET;
    rotatingAssembly.add(mountGroup);

    // Stationary pole (gold) — horse slides up/down on it via horseContainer bobbing.
    // Slightly thicker than GLB's built-in pole to conceal it during bob.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 7.2, 12), goldMat
    );
    pole.position.y = 3.6; // centered: spans Y 0–7.2 in mountGroup space
    pole.castShadow = true;
    mountGroup.add(pole);

    // Horse container group (for Y-bobbing)
    const horseContainer = new THREE.Group();
    horseContainer.name = `horse_container_${i}`;
    mountGroup.add(horseContainer);

    // Cloned horse mesh
    const horse = rawHorse.clone(true);
    horse.name = `horse_mesh_${i}`;
    horse.scale.setScalar(horseScale);
    // Center model geometry offset
    horse.position.copy(horseCenter).multiplyScalar(-horseScale);
    horseContainer.add(horse);

    // Add Quaternius human rider sitting on the horse
    let rider = null;
    let riderHeight = 0;
    if (activeVisitors && activeVisitors.length > 0) {
      const tmpl = activeVisitors[i % activeVisitors.length];
      const currentHeight = getPassengerWorldHeight();
      riderHeight = currentHeight;
      rider = makeRider(tmpl, currentHeight, {
        // mostly both-hands-on-pole, with occasional waves/looks
        pool: ['holdPole', 'holdPole', 'holdPole', 'holdPole', 'wave', 'lookL', 'lookR', 'cheer'],
        facingY: 0,
        phase: i * (Math.PI / 4),
        seatedStyle: 'horse'
      });
      rider.index = i;
      
      // Position rider realistically on the horse saddle:
      const saddleHeight = 0.48 * (targetHorseY / 2.4);
      const scale = currentHeight / tmpl.height;
      const targetHipX = 0.32 + 0.35 * scale;

      rider.pivot.rotation.y = - Math.PI / 2; // Face forward along with horse (aligns rider +Z with horse -X)
      positionRiderOnHip(rider, tmpl, new THREE.Vector3(targetHipX, saddleHeight, 0.0), scale);

      rider.height = currentHeight;
      horseContainer.add(rider.pivot);

      horses.push({
        container: horseContainer,
        rider: rider,
        phaseOffset: i * (Math.PI / 4) // phase-offset wave pattern
      });

      // ── FPV camera-rig at rider's head, in horseContainer-local.
      //    Container +X = tangential forward (travel). Rotated -90° around Y
      //    so rig's -Z (camera look) = container's +X (forward).
      //    Inherits carousel yaw + horse Y-bob.
      //    Created always (even without rider) so FPV works regardless of visitor load.
      const cameraRig = new THREE.Group();
      cameraRig.name = 'cameraRig';
      const headX = rider ? rider.pivot.position.x : 0.5;
      const headY = rider ? rider.pivot.position.y + rider.height * 0.85 : 0.6 + riderHeight * 0.85;
      const headZ = rider ? rider.pivot.position.z : 0;
      cameraRig.position.set(headX, headY, headZ);
      cameraRig.rotation.y = Math.PI / 2;
      horseContainer.add(cameraRig);
      horses[horses.length - 1].cameraRig = cameraRig;
    } else {
      // No visitors — still create camera-rig at default head position
      const cameraRig = new THREE.Group();
      cameraRig.name = 'cameraRig';
      cameraRig.position.set(0.5, 0.6 + riderHeight * 0.85, 0);
      cameraRig.rotation.y = Math.PI / 2;
      horseContainer.add(cameraRig);
      horses.push({
        container: horseContainer,
        rider: null,
        cameraRig,
        phaseOffset: i * (Math.PI / 4)
      });
    }
  }

  // ── Control Panel (semaphore + lever) ──
  const controlPanel = buildControlPanel({ initialRunning: true });
  controlPanel.group.position.set(-15, 0, 15); // Southwest of carousel, toward park center (mirrors FerrisWheel panel)
  group.add(controlPanel.group);
  controlPanel.group.lookAt(0, 1.35, 0);
  controlPanel.group.rotateY(Math.PI);

  // ── Controller / State ──
  const controller = new CarouselController(group, rotatingAssembly, horses);
  controller.panel = controlPanel.group;
  controlPanel.group.updateState = (running) => {
    if (controlPanel.running !== running) {
      controlPanel.toggle();
    }
  };

  controller.addEventBusListener('color-change', (hex) => {
    const target = new THREE.Color(hex);
    const tween1 = new TWEEN.Tween(mainColor)
      .to(target, 500)
      .easing(Easings.COLOR)
      .onUpdate(() => {
        bulbs.forEach(b => { b.material.color.copy(mainColor); b.material.emissive.copy(mainColor); });
        ridePointLights.forEach(pl => pl.color.copy(mainColor));
      });
    controller.trackTween(tween1);
    tween1.start();

    const tween2 = new TWEEN.Tween(warmColor)
      .to(target, 500)
      .easing(Easings.COLOR)
      .onUpdate(() => {
        const tint = (m) => { m.color.copy(warmColor); m.emissive.copy(warmColor); };
        cFestoon.forEach(b => tint(b.material));
        cSeam.forEach(b => tint(b.material));
        cColumn.forEach(b => tint(b.material));
        tint(cNeonMat);
      });
    controller.trackTween(tween2);
    tween2.start();
  });

  group.userData.tick = (delta, time) => {
    // Gradual start/stop transitions driven by the shared ControlPanel
    const { ease, speedMult } = controller.tickSpeed(controlPanel, delta);

    // 1. Platform rotation
    controller.angle += controller.maxSpeed * ease * speedMult * delta;
    rotatingAssembly.rotation.y = - controller.angle;

    // 2. Horse bobbing (each horse has phase offset) and rider updates
    const platformY = 0.6;
    const maxWorldHeadY = 6.8;
    for (const h of horses) {
      const wave = (Math.sin(time * HORSE_BOB_FREQ + h.phaseOffset) + 1.0) * BOB_AMP;
      
      let maxContainerY = Infinity;
      if (h.rider) {
        const riderY = h.rider.pivot.position.y;
        const riderHeight = h.rider.height;
        maxContainerY = maxWorldHeadY - platformY - (riderY + riderHeight);
      }
      
      const targetY = (HORSE_BASE_Y - BOB_AMP) + wave * ease;
      // Clamp at bottom (targetHorseY / 2) to prevent ground clipping, and at top (maxContainerY) to prevent ceiling clipping
      h.container.position.y = Math.max(targetHorseY / 2.0, Math.min(targetY, maxContainerY));
      
      if (h.rider) {
        updateRider(h.rider, time + h.rider.phase);
        // Inertia: the body lags the horse's bob — compress on the way up,
        // lighten on the way down, with a slight fore/aft rock.
        if (h.riderRestY === undefined) {
          h.riderRestY = h.rider.pivot.position.y;
          h.lastCY = h.container.position.y;
          h.cvy = 0;
        }
        const dtc = Math.min(Math.max(delta, 1e-3), 0.05);
        const cvyNow = (h.container.position.y - h.lastCY) / dtc;
        h.lastCY = h.container.position.y;
        h.cvy += (cvyNow - h.cvy) * Math.min(1, dtc * 10);
        const lag = Math.max(-0.09, Math.min(0.09, h.cvy * 0.05));
        h.rider.pivot.position.y = h.riderRestY - lag;
        h.rider.pivot.rotation.z = lag * 0.8;
      }
    }

    // 3. Emissive bulbs blink at night (read night state from scene lights)
    const isNight = isNightNow(group);

    if (isNight) {
      bulbs.forEach((b, idx) => {
        const pulse = Math.sin(time * 5.0 + idx * 0.4) * 0.5 + 0.5;
        b.material.emissiveIntensity = 1.0 + pulse * 1.5;
      });
      ridePointLights.forEach((pl, idx) => {
        const isCenter = idx === 0;
        const pulse = Math.sin(time * 5.0 + idx * 1.6) * 0.5 + 0.5;
        pl.intensity = isCenter ? (1.0 + pulse * 0.5) * 120.0 : (1.0 + pulse * 1.5) * 35.0;
      });
    } else {
      bulbs.forEach((b) => { b.material.emissiveIntensity = 0.0; });
      ridePointLights.forEach((pl) => { pl.intensity = 0.0; });
    }

    // Smoothed festoon / seam / column / neon light show (nicer fades than the hard on/off above)
    controller.nightMix = nightMixLerp(controller.nightMix, isNight, delta, 2.2);
    const nf = controller.nightMix;
    for (let i = 0; i < cFestoon.length; i++) {
      const chase = 0.5 + 0.5 * Math.sin(time * 5.0 - i * 0.5);
      cFestoon[i].material.emissiveIntensity = nf * (0.5 + chase * 2.4);
    }
    for (let i = 0; i < cSeam.length; i++) {
      const chase = 0.5 + 0.5 * Math.sin(time * 4.0 - i * 0.3);
      cSeam[i].material.emissiveIntensity = nf * (0.4 + chase * 2.0);
    }
    for (let i = 0; i < cColumn.length; i++) {
      const p = 0.5 + 0.5 * Math.sin(time * 3.0 + i * 0.7);
      cColumn[i].material.emissiveIntensity = nf * (0.6 + p * 1.5);
    }
    cNeonMat.emissiveIntensity = nf * (1.2 + 0.6 * Math.sin(time * 2.2));
    carouselCanopyLight.intensity = nf * 2.2;

  };

  controller.applyBloomLayers();

  group.userData.controller = controller;
  return group;
}

function hideEmbeddedPole(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geom = o.geometry;
    
    const posAttr = geom.getAttribute('position');
    if (!posAttr) return;

    const normalAttr = geom.getAttribute('normal');
    const uvAttr = geom.getAttribute('uv');
    const tangentAttr = geom.getAttribute('tangent');

    const keptIndices = [];
    const newPositions = [];
    const newNormals = [];
    const newUvs = [];
    const newTangents = [];

    const indexMap = new Map();
    let newIdx = 0;
    
    const vertexCount = posAttr.count;
    for (let i = 0; i < vertexCount; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      
      // The pole is centered at (0, 0) in local X-Y, with radius approx 3.683.
      // We filter out any vertices that are close to the pole axis (X^2 + Y^2 < 4.5^2).
      const isPole = (x * x + y * y < 4.5 * 4.5);
      if (!isPole) {
        newPositions.push(x, y, z);
        if (normalAttr) {
          newNormals.push(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
        }
        if (uvAttr) {
          newUvs.push(uvAttr.getX(i), uvAttr.getY(i));
        }
        if (tangentAttr) {
          newTangents.push(tangentAttr.getX(i), tangentAttr.getY(i), tangentAttr.getZ(i), tangentAttr.getW(i));
        }
        indexMap.set(i, newIdx++);
      }
    }
    
    const indexAttr = geom.getIndex();
    const newIndexData = [];
    if (indexAttr) {
      const arr = indexAttr.array;
      const len = arr.length;
      for (let i = 0; i < len; i += 3) {
        const idx0 = arr[i];
        const idx1 = arr[i + 1];
        const idx2 = arr[i + 2];
        if (indexMap.has(idx0) && indexMap.has(idx1) && indexMap.has(idx2)) {
          newIndexData.push(indexMap.get(idx0), indexMap.get(idx1), indexMap.get(idx2));
        }
      }
    }
    
    const newGeom = new THREE.BufferGeometry();
    newGeom.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    if (newNormals.length > 0) {
      newGeom.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
    }
    if (newUvs.length > 0) {
      newGeom.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
    }
    if (newTangents.length > 0) {
      newGeom.setAttribute('tangent', new THREE.Float32BufferAttribute(newTangents, 4));
    }
    if (newIndexData.length > 0) {
      newGeom.setIndex(newIndexData);
    }
    
    newGeom.computeBoundingBox();
    newGeom.computeBoundingSphere();
    
    o.geometry = newGeom;
  });
}
