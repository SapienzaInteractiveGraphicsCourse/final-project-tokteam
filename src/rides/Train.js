import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { buildControlPanel } from '../ui/ControlPanel.js';
import { eventBus } from '../utils/EventBus.js';
import { Easings } from '../utils/Easings.js';
import { isNightNow } from '../lighting/DayNightCycle.js';
import { loadGLB } from '../utils/loaders.js';
import { loadVisitorTemplates, makeRider, updateRider, getPassengerWorldHeight, positionRiderOnHip } from '../people/Passengers.js';
import { RideBase } from './RideBase.js';
import { createEmissiveBulb, createPointLight, nightMixLerp } from '../utils/rideUtils.js';

class TrainController extends RideBase {
  constructor(group, cars, riders) {
    super(group, { running: true });
    this.cars = cars;
    this.riders = riders;
    this.uLead = 0;
  }

  getFpvTarget() {
    return this.cars[0]?.cameraRig || null;
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
    return this.riders ? this.riders.slice(0, 1) : [];
  }
}


// ── CatmullRom control points for the train ring ─
const CONTROL_POINTS = [
  new THREE.Vector3(0, 11.0, -58),    // Central north apex — panoramic height above stage
  new THREE.Vector3(45, 11.0, -80),   // NE high — central section stays parallel to ground at apex height
  new THREE.Vector3(60, 11.0, -82),   // NE approach — start of high section approaching the descent
  new THREE.Vector3(82, 0.5, -82),    // NE corner — steep descent point, ground level (NE corner preserved)
  new THREE.Vector3(92, 1.0, -40),    // East-North (curves south from the NE corner as before)
  new THREE.Vector3(88, 3.5, -12),    // East transition
  new THREE.Vector3(72, 5.5, 12),     // East River crossing
  new THREE.Vector3(45, 8.5, 18),     // Curve north of coaster
  new THREE.Vector3(22, 11.5, 26),    // High scenic bridge
  new THREE.Vector3(15, 11.5, 34),    // High flyover
  new THREE.Vector3(0, 11.5, 39),     // High street crossing
  new THREE.Vector3(-6.0, 11.5, 43.5),
  new THREE.Vector3(-18, 11.5, 60),   // High curve between trees
  new THREE.Vector3(-50, 6.5, 78),    // South-West transition
  new THREE.Vector3(-85, 1.2, 92),    // SW outer corner
  new THREE.Vector3(-92, 0.3, 40),    // West-South
  new THREE.Vector3(-92, 5.5, 0),     // West River crossing
  new THREE.Vector3(-92, 3.0, -40),   // West-North lifted (smoother join to NW arc)
  new THREE.Vector3(-82, 5.5, -82),   // NW outer — ascent toward apex
  new THREE.Vector3(-45, 8.0, -80),   // NW shoulder — gentle ascent toward apex
];

const TRAIN_SPEED = 6;

export async function buildTrain({ anisotropy = 8 } = {}) {
  const group = new THREE.Group();
  group.name = 'train';

  const curve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, 'catmullrom', 0.5);
  // Override curve methods to prevent Y from dipping underground (Y-clamp)
  const originalGetPointAt = curve.getPointAt.bind(curve);
  curve.getPointAt = function(u, target) {
    const p = originalGetPointAt(u, target);
    p.y = Math.max(0.2, p.y);
    return p;
  };
  const originalGetPoint = curve.getPoint.bind(curve);
  curve.getPoint = function(t, target) {
    const p = originalGetPoint(t, target);
    p.y = Math.max(0.2, p.y);
    return p;
  };

  curve.arcLengthDivisions = 10000;
  const trackLength = curve.getLength();

  // ── Track Footprint for NavGrid ──
  const footprintPts = [];
  for (let i = 0; i < 500; i++) {
    const p = curve.getPointAt(i / 500);
    footprintPts.push(p.x, p.z);
  }
  group.userData.footprint = { pts: footprintPts, pad: 7.5 };

  // ── Build physical track (Rails & Sleepers) ──
  const pts = curve.getPoints(500);
  const leftPts = [], rightPts = [];
  const tangent = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3();
  
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    curve.getTangent(t, tangent);
    right.crossVectors(tangent, up).normalize();
    leftPts.push(pts[i].clone().addScaledVector(right, -1.0));
    rightPts.push(pts[i].clone().addScaledVector(right, 1.0));
  }
  
  const railMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.4 });
  const railL = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leftPts, true), 500, 0.1, 6, true), railMat);
  const railR = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rightPts, true), 500, 0.1, 6, true), railMat);
  railL.castShadow = true; railL.receiveShadow = true;
  railR.castShadow = true; railR.receiveShadow = true;
  group.add(railL, railR);

  const sleeperGeom = new THREE.BoxGeometry(3.0, 0.15, 0.4);
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 });
  const sleeperCount = 350;
  const sleepers = new THREE.InstancedMesh(sleeperGeom, sleeperMat, sleeperCount);
  sleepers.castShadow = true; sleepers.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < sleeperCount; i++) {
    const t = i / sleeperCount;
    const p = curve.getPointAt(t);
    curve.getTangentAt(t, tangent);
    dummy.position.copy(p);
    dummy.position.y -= 0.05;
    dummy.lookAt(p.clone().add(tangent));
    dummy.updateMatrix();
    sleepers.setMatrixAt(i, dummy.matrix);
  }
  group.add(sleepers);

  // ── Support Pillars for elevated track (in pairs) ──
  let pillarCount = 0;
  const pillarInterval = 6; // place support every 6 sleepers
  for (let i = 0; i < sleeperCount; i += pillarInterval) {
    const t = i / sleeperCount;
    const p = curve.getPointAt(t);
    // Skip if not elevated, or if over the main street (X centered at 0, width ~6) or the river (Z centered at 0, width ~20)
    // Also skip placing pillars inside the Roller Coaster area (X > 20, Z > 30) to avoid clipping with coaster structures,
    // and near the Shooting Gallery (around X=12, Z=24)
    if (p.y > 1.5 && Math.abs(p.x) >= 4.0 && Math.abs(p.z) >= 12.0 && !(p.x > 20.0 && p.z > 30.0) && !(Math.abs(p.x - 12.0) < 5.0 && Math.abs(p.z - 24.0) < 5.0)) {
      pillarCount += 2;
    }
  }

  const pillarGeom = new THREE.CylinderGeometry(0.12, 0.16, 1.0, 8); // paired, slightly thinner columns
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.7 });
  const pillars = new THREE.InstancedMesh(pillarGeom, pillarMat, pillarCount);
  pillars.castShadow = true; pillars.receiveShadow = true;

  let pillarIdx = 0;
  const dummyPillar = new THREE.Object3D();
  const tempRight = new THREE.Vector3();
  const tempTangent = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < sleeperCount; i += pillarInterval) {
    const t = i / sleeperCount;
    const p = curve.getPointAt(t);
    
    if (p.y > 1.5 && Math.abs(p.x) >= 4.0 && Math.abs(p.z) >= 12.0 && !(p.x > 20.0 && p.z > 30.0) && !(Math.abs(p.x - 12.0) < 5.0 && Math.abs(p.z - 24.0) < 5.0)) {
      curve.getTangentAt(t, tempTangent);
      tempRight.crossVectors(tempTangent, upVec).normalize();
      
      const h = p.y - 0.1;
      
      // Left pillar (-0.85 offset along right vector)
      const leftPos = p.clone().addScaledVector(tempRight, -0.85);
      dummyPillar.position.set(leftPos.x, h / 2, leftPos.z);
      dummyPillar.scale.set(1, h, 1);
      dummyPillar.rotation.set(0, 0, 0);
      dummyPillar.updateMatrix();
      pillars.setMatrixAt(pillarIdx++, dummyPillar.matrix);
      
      // Right pillar (0.85 offset along right vector)
      const rightPos = p.clone().addScaledVector(tempRight, 0.85);
      dummyPillar.position.set(rightPos.x, h / 2, rightPos.z);
      dummyPillar.scale.set(1, h, 1);
      dummyPillar.rotation.set(0, 0, 0);
      dummyPillar.updateMatrix();
      pillars.setMatrixAt(pillarIdx++, dummyPillar.matrix);
    }
  }
  group.add(pillars);

  // ── Load Wacky Worm Coaster Model (split into individual wagons) ──
  const cars = [];
  const nightLights = [];
  const riders = [];

  try {
    const gltf = await loadGLB('assets/models/rides/wacky_worm.glb');
    const trainModel = gltf.scene;

    // Remove track nodes (project has custom track)
    const trackNodes = [];
    trainModel.traverse((node) => {
      if (node.name && node.name.startsWith('track')) {
        trackNodes.push(node);
      }
    });
    trackNodes.forEach((node) => {
      if (node.parent) {
        node.parent.remove(node);
      }
    });

    // Reset pre-applied transforms on coaster nodes (scale=0.01, rotation quaternions)
    // Keep translations (relative positions of carriages)
    trainModel.traverse((node) => {
      if (node.isMesh) return;
      // Reset scale from 0.01 to 1.0
      if (Math.abs(node.scale.x - 0.01) < 0.001) {
        node.scale.set(1, 1, 1);
      }
      // Reset rotation to identity (clear quaternion)
      node.quaternion.identity();
      node.rotation.set(0, 0, 0);
      // Reset matrix to force recalculation
      node.matrix.identity();
      node.matrixAutoUpdate = true;
    });

    // Replace materials with standard PBR (original uses KHR_materials_pbrSpecularGlossiness with white diffuse)
    const carriageColors = {
      'coaster_front': 0x22aa44,    // head - green
      'coaster_back': 0x2244cc,     // first wagon - blue
      'coaster_back001': 0xcc2222,  // second wagon - red
      'coaster_back002': 0xcccc22,  // third wagon - yellow
      'coaster_back003': 0xcc6622,  // fourth wagon - orange
    };

    // ── 1. Identify wagon nodes (direct children of RootNode, exclude track) ──
    const wagonNodes = [];
    trainModel.traverse((node) => {
      if (node.name && node.name.startsWith('coaster') && node.parent?.name === 'RootNode') {
        wagonNodes.push(node);
      }
    });

    // ── 2. Spatial sort by Z position (descending) ──
    wagonNodes.sort((a, b) => b.position.z - a.position.z);

    // ── 3. Deep-clone + zero-out transforms (fix flying wagons) ──
    const SCALE = 0.030;
    const CAR_SPACING = 4.0;
    const wagonGroups = [];
    let wagonIdx = 0;

    for (const wn of wagonNodes) {
      const subtree = wn.clone(true);
      const wagonGroup = new THREE.Group();
      const wnColor = carriageColors[wn.name] ?? 0xcccccc;

      // Avoid mutation-during-traverse by collecting meshes first
      const meshes = [];
      subtree.traverse((child) => {
        if (child.isMesh) meshes.push(child);
      });

      for (const child of meshes) {
        child.position.set(0, 0, 0);
        child.rotation.set(0, 0, 0);
        child.quaternion.identity();
        child.scale.set(1, 1, 1);
        child.matrix.identity();
        child.matrixAutoUpdate = true;
        child.castShadow = true;
        child.receiveShadow = true;
        
        // Preserve original texture maps while applying the custom wagon tint color
        const origMat = child.material;
        const newMat = new THREE.MeshStandardMaterial({
          color: wnColor,
          map: origMat.map || null,
          normalMap: origMat.normalMap || null,
          roughnessMap: origMat.roughnessMap || null,
          metalnessMap: origMat.metalnessMap || null,
          emissive: new THREE.Color(wnColor),
          emissiveMap: origMat.map || null,
          emissiveIntensity: 0.0,
          roughness: 0.7,
          metalness: 0.1,
          envMapIntensity: 0,
          toneMapped: false
        });
        child.material = newMat;
        nightLights.push({ type: 'body-mat', mat: newMat });
        
        wagonGroup.add(child);
      }

      // Restore upright orientation (model authored lying down, +Z is "up" in model)
      wagonGroup.rotation.x = -Math.PI / 2;
      wagonGroup.updateMatrixWorld(true);

      // Center: X/Z at geometric center, bottom at Y=0
      const bbox = new THREE.Box3().setFromObject(wagonGroup);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      wagonGroup.position.set(-center.x, -bbox.min.y, -center.z);

      const wrapper = new THREE.Group();
      wrapper.scale.setScalar(SCALE);
      
      // Soft coloured under-light pools a glow on the ground below each car (using world distance of 10.0 units)
      const under = new THREE.PointLight(wnColor, 0.0, 10.0, 2.0);
      under.position.set(0, -5.0, 0); // slightly below the wagon
      under.layers.set(2);
      wagonGroup.add(under);
      nightLights.push({ type: 'under-light', light: under });

      // Warm interior lamp for riders (using world distance of 7.5 units)
      const interiorLight = new THREE.PointLight(0xffd9a0, 0.0, 7.5, 2.0);
      interiorLight.position.set(0, 60.0, 0); // Positioned exactly above the passengers in wrapper space
      interiorLight.layers.set(2);
      wrapper.add(interiorLight);
      nightLights.push({ type: 'interior-light', light: interiorLight });

      const widthX = bbox.max.x - bbox.min.x;
      const heightY = bbox.max.y - bbox.min.y;
      const depthZ = bbox.max.z - bbox.min.z;

      // Add decorative warm-white cabochon light bulbs on the sides of the wagon
      const sideBulbMat = new THREE.MeshStandardMaterial({
        color: 0xffeebb,
        emissive: 0xffeebb,
        emissiveIntensity: 0.0,
        roughness: 0.2,
        metalness: 0.8,
        toneMapped: false
      });
      const bulbGeo = new THREE.SphereGeometry(4.0, 16, 16);
      const sideBulbMeshes = [];

      // Position passenger bulbs based on the exact shape of the real mesh
      const isFront = (wagonIdx === 0);
      const bulbPositions = [];
      
      if (isFront) {
        // Antenna balls: Place exactly inside the geometry of the antennae
        // Colored same as carriage, turning glowing white/warm at night
        const antennaBulbGeo = new THREE.SphereGeometry(7.0, 16, 16);
        const antennaMat = new THREE.MeshStandardMaterial({
          color: wnColor,
          emissive: 0xffeebb,
          emissiveIntensity: 0.0,
          roughness: 0.7,
          metalness: 0.1,
          toneMapped: false
        });

        const rightAntenna = new THREE.Mesh(antennaBulbGeo, antennaMat);
        rightAntenna.position.set(41.6, 169.0, 55.4); // lowered Y from 174.7
        wrapper.add(rightAntenna);
        sideBulbMeshes.push(rightAntenna);

        const leftAntenna = new THREE.Mesh(antennaBulbGeo, antennaMat);
        leftAntenna.position.set(-41.6, 169.0, 55.4); // lowered Y from 174.7
        wrapper.add(leftAntenna);
        sideBulbMeshes.push(leftAntenna);
      } else {
        // Passenger carriages: Exact coordinates from mesh vertex sampling
        // to ensure zero floating. We sink them slightly (1.0 unit) into the mesh.
        bulbPositions.push(
          // Left side
          { x: -39.5, y: 97.5, z: -60 }, // Front
          { x: -41.5, y: 80.3, z: 0 },   // Middle
          { x: -38.2, y: 80.3, z: 40 },  // Back
          // Right side
          { x: 39.5, y: 97.5, z: -60 },
          { x: 41.5, y: 80.3, z: 0 },
          { x: 38.2, y: 80.3, z: 40 }
        );
      }

      for (const pos of bulbPositions) {
        const bulb = new THREE.Mesh(bulbGeo, sideBulbMat);
        bulb.position.set(pos.x, pos.y, pos.z);
        wrapper.add(bulb);
        sideBulbMeshes.push(bulb);
      }

      // Add to nightLights as wagon-bulbs with unique phase per wagon
      nightLights.push({
        type: 'wagon-bulbs',
        meshes: sideBulbMeshes,
        phase: wagonIdx * 1.5
      });

      wrapper.add(wagonGroup);
      wrapper.updateMatrixWorld(true);

      wagonGroups.push(wrapper);
      wagonIdx++;
    }

    // ── 5. Populate cars array with progressive offsets ──
    for (let i = 0; i < wagonGroups.length; i++) {
      group.add(wagonGroups[i]);
      cars.push({ mesh: wagonGroups[i], offset: i * CAR_SPACING });
    }

    // ── FPV camera-rig: positioned at the rider's eye height inside the
    //    first car. The wrapper's local +Z holds the cabin content (rider at
    //    z=-20, headlights at z=+77, look target at z=+150), so we rotate the
    //    rig 180° around Y so its -Z (camera look) aligns with the wrapper's
    //    +Z (forward, in the same convention the existing FPV offsets use).
    //    Inherits the car's position, lookAt-driven yaw, and the curve-banking
    //    tilt applied in tick (cars[i].mesh.rotateZ at line ~514).
    {
      const firstCar = cars[0];
      const cameraRig = new THREE.Group();
      cameraRig.name = 'cameraRig';
      cameraRig.position.set(0, 136.0, -26.0);
      cameraRig.rotation.y = Math.PI;
      firstCar.mesh.add(cameraRig);
      firstCar.cameraRig = cameraRig;
    }

    // ── 6. Front Headlight (Locomotive) ──
    if (cars.length > 0) {
      const loco = cars[0].mesh;
      const wnColor = 0x22aa44; // Base color of the front wagon

      // Emissive bulb mesh (reduced size, colored to match body during day)
      const bulbGeo = new THREE.SphereGeometry(12.0, 32, 32); 
      const bulbMat = new THREE.MeshStandardMaterial({
        color: wnColor,
        emissive: 0xfff2d0,
        emissiveIntensity: 0.0,
        roughness: 0.7,
        metalness: 0.1,
        toneMapped: false
      });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.set(0, 80.0, 77.0); // Fit perfectly on the snout nose bump
      loco.add(bulb);

      // Spotlight pointing forward (range and position scaled)
      const spotLight = new THREE.SpotLight(0xfff2d0, 0, 60, Math.PI / 6, 0.6, 1.0);
      spotLight.position.set(0, 80.0, 79.0);
      spotLight.castShadow = true;
      spotLight.shadow.mapSize.width = 512;
      spotLight.shadow.mapSize.height = 512;
      spotLight.shadow.camera.near = 15.0;
      spotLight.shadow.camera.far = 3000;

      const target = new THREE.Object3D();
      target.position.set(0, 45.0, 300.0);
      loco.add(spotLight);
      loco.add(target);
      spotLight.target = target;

      nightLights.push({
        type: 'spot',
        light: spotLight,
        mesh: bulb
      });
    }

    // ── 7. Passengers ──
    const templates = await loadVisitorTemplates(10);
    for (let i = 0; i < wagonGroups.length; i++) {
      const wrapper = wagonGroups[i];
      const tmpl = templates[i % templates.length];
      const riderHeight = (getPassengerWorldHeight() * 0.88) / 0.030;

      const rider = makeRider(tmpl, riderHeight, {
        pool: ['rest'],
        facingY: 0,
        phase: i * 1.7,
        seatedStyle: 'chair'
      });

      const sx = 0; // centered seating
      const sy = 78.0; // raised to sit on the seat cushion (profile minY = 77.7)
      const sz = -20.0; // shifted forward so legs hang down in front of seat cushion (originally -35.0 / -50.0)

      const scale = riderHeight / tmpl.height;
      positionRiderOnHip(rider, tmpl, new THREE.Vector3(sx, sy, sz), scale);

      wrapper.add(rider.pivot);
      riders.push(rider);
    }

  } catch (e) {
    console.warn('Could not load wacky_worm.glb', e);
  }

  // ── Control Panel ──
  const panel = buildControlPanel({
    initialRunning: true,
    onToggle: (isRunning) => { controller.running = isRunning; },
    rampUp: 1.5,
    rampDown: 2.0,
  });
  group.add(panel.group);

  const controller = new TrainController(group, cars, riders);
  controller.panel = panel.group;

  // Bridge controller state to ControlPanel
  panel.group.updateState = (running) => {
    if (panel.running !== running) {
      panel.toggle();
    }
  };

  let lightColor = new THREE.Color(0xffcc66);
  controller.addEventBusListener('color-change', (hex) => {
    const target = new THREE.Color(hex);
    const tween = new TWEEN.Tween(lightColor)
      .to(target, 500)
      .easing(Easings.COLOR);
    controller.trackTween(tween);
    tween.start();
  });

  const _lookTarget = new THREE.Vector3();
  const _crossVec   = new THREE.Vector3();

  group.userData.tick = (delta, time) => {
    const dt = Math.min(delta, 0.05);
    const panelEase = panel.tick(dt);
    
    controller.nightMix = nightMixLerp(controller.nightMix, isNightNow(group), dt, 3);
    const nightMix = controller.nightMix;

    if (panelEase > 0.01) {
      const speed = TRAIN_SPEED * controller.speedMultiplier * panelEase;
      controller.uLead = (controller.uLead + (speed / trackLength) * dt) % 1;
      if (controller.uLead < 0) controller.uLead += 1;
    }

    // Position each wagon along curve
    for (let i = 0; i < cars.length; i++) {
      const carU = (controller.uLead - (cars[i].offset / trackLength) + 1) % 1;
      const pos = curve.getPointAt(carU);
      const tangent = curve.getTangentAt(carU);
      
      cars[i].mesh.position.copy(pos);
      _lookTarget.copy(pos).add(tangent);
      cars[i].mesh.lookAt(_lookTarget);

      // Tilt
      const nextTangent = curve.getTangentAt((carU + 0.001) % 1);
      const cross = _crossVec.crossVectors(tangent, nextTangent);
      cars[i].mesh.rotateZ(cross.y * 2);
    }

    // Update passengers animation
    for (const r of riders) {
      updateRider(r, time);
    }

    for (const nl of nightLights) {
      if (nl.type === 'spot') {
        nl.light.intensity = nightMix * 120.0;
        nl.light.color.copy(lightColor);
        nl.mesh.material.emissiveIntensity = nightMix * 2.0;
        nl.mesh.material.emissive.copy(lightColor);
      } else if (nl.type === 'point') {
        const glow = nightMix * (0.6 + 0.4 * Math.sin(time * 3 + nl.phase));
        nl.light.intensity = glow * 8.0;
        nl.light.color.copy(lightColor);
        nl.mesh.material.emissiveIntensity = glow;
        nl.mesh.material.emissive.copy(lightColor);
      } else if (nl.type === 'wagon-bulbs') {
        const glow = nightMix * (0.6 + 0.4 * Math.sin(time * 4 + nl.phase));
        for (const mesh of nl.meshes) {
          mesh.material.emissiveIntensity = glow * 3.0;
          mesh.material.emissive.copy(lightColor);
        }
      } else if (nl.type === 'body-mat') {
        nl.mat.emissiveIntensity = 0.0; // Disabled body glow to preserve PBR shading
      } else if (nl.type === 'under-light') {
        nl.light.intensity = nightMix * 6.0; // Balanced underglow
        nl.light.color.copy(lightColor);
      } else if (nl.type === 'interior-light') {
        nl.light.intensity = nightMix * 4.0; // Subtle interior light
        nl.light.color.copy(lightColor);
      }
    }
  };

  controller.applyBloomLayers();

  group.userData.controller = controller;
  return group;
}

