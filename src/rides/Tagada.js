import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { loadVisitorTemplates, makeRider, updateRider, pose, getPassengerWorldHeight, applyChairSeatedLegs, positionRiderOnHip } from '../people/Passengers.js';
import { buildControlPanel } from '../ui/ControlPanel.js';
import { eventBus } from '../utils/EventBus.js';
import { Easings } from '../utils/Easings.js';
import { isNightNow } from '../lighting/DayNightCycle.js';
import { RideBase } from './RideBase.js';
import { createPlatformTexture, createCanopyTexture } from '../utils/textures.js';
import { createEmissiveBulb, createPointLight, nightMixLerp } from '../utils/rideUtils.js';

class TagadaController extends RideBase {
  constructor(group, armPivot, discMeshGroup, seats) {
    super(group, { running: true });
    this.armPivot = armPivot;
    this.discMeshGroup = discMeshGroup;
    this.seats = seats;
    this.spinAngle = 0;
    this.pitchAngle = 0;
    this.rollAngle = 0;
    this.bumpAngle = 0;
    this.armYawAngle = 0;
    this.maxSpeed = MAX_SPIN_SPEED;
  }

  getFpvTarget() {
    return this.seats[0]?.cameraRig || null;
  }

  getFpvCameraPos(target, out) {
    target.getWorldPosition(out);
  }

  getFpvLookTarget(target, out) {
    const fpvTmpVec = new THREE.Vector3(0, 0, 10);
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
    const r = this.seats[0]?.rider;
    return r ? [r] : [];
  }
}


// Ride Animation Constants
const MAX_SPIN_SPEED = 2.0;       // rad/s platform rotation at full speed
const BASE_PITCH = 0.28;          // Rest pitch tilt of the arm
const PITCH_AMP = 0.16;           // Pitch oscillation amplitude
const PITCH_FREQ = 2.6;           // Pitch speed (rad/s)
const ROLL_AMP = 0.22;            // Roll oscillation amplitude
const ROLL_FREQ = 1.9;            // Roll speed (rad/s)
const ARM_YAW_SPEED = 0.4;        // Radiant speed for the arm's horizontal rotation
const ARM_PIVOT_Y = 0.4;
const BOARDING_DROP = 7.5;         // How much the arm telescopes down when stopped
const MIN_ARM_LENGTH = 1.5;        // Prevents the arm from collapsing fully

// Jitter/shaking parameters for passengers
const JITTER_FREQ = 14.0;
const JITTER_AMP = 0.02;

const BUMP_FREQ = 18.0; // High frequency for rapid shakes
const BUMP_AMP = 0.04;  // Sharp, short rotation jolts in radians

const TAGADA_ACTIONS = ['cheer', 'wave', 'cheer', 'wave', 'lookUp', 'relax', 'rest'];

// Jewel-tone seat palette (alternates around the disc)
const SEAT_COLORS = [0xe53935, 0x1e88e5, 0xffb300, 0x8e24aa, 0x00acc1, 0x43a047, 0xf4511e, 0x3949ab];



export async function buildTagada({ position = [-40, 0, 40], camera, renderer, anisotropy = 8 } = {}) {
  // Load 8 random visitor templates for the seats
  const visitors = await loadVisitorTemplates(8);

  const group = new THREE.Group();
  group.name = 'tagada';
  group.position.set(position[0], position[1], position[2]);

  // ── Materials ──────────────────────────────────────────────────────────────
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe9eef2, metalness: 1.0, roughness: 0.12 });
  const darkChromeMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1.0, roughness: 0.22 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: 1.0, roughness: 0.2 });
  const metalPedestalMat = new THREE.MeshStandardMaterial({ color: 0x222838, roughness: 0.4, metalness: 0.85 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0xc7ccd2, metalness: 0.95, roughness: 0.18 });
  const armAccentMat = new THREE.MeshStandardMaterial({ color: 0xe53935, metalness: 0.5, roughness: 0.35 });

  const discTex = createPlatformTexture();
  discTex.anisotropy = anisotropy;
  // Low-intensity emissive map keeps the sunburst readable at grazing angles / under the canopy.
  const platformMat = new THREE.MeshStandardMaterial({
    map: discTex, emissive: 0xffffff, emissiveMap: discTex, emissiveIntensity: 0.22,
    roughness: 0.6, metalness: 0.0,
  });

  const canopyTex = createCanopyTexture();
  canopyTex.anisotropy = anisotropy;
  // Fabric also lights up: emissiveMap = the stripe texture, driven up at night in the tick.
  const canopyMat = new THREE.MeshStandardMaterial({
    map: canopyTex, emissive: 0xffffff, emissiveMap: canopyTex, emissiveIntensity: 0.0,
    roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide,
  });

  const seatFrameMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.8 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.95, roughness: 0.06 });
  const baseConcreteMat = new THREE.MeshStandardMaterial({ color: 0x4c525a, roughness: 0.9, metalness: 0.05 });
  const baseHousingMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });

  // Emissive helpers — start subtle (glow by day), driven brighter at night in the tick.
  const neon = (hex) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.3, roughness: 0.25, metalness: 0.1 });

  // Animated-light registries
  const canopyBulbs = [];
  const ledRings = [];
  const rimBulbs = [];
  const basePanels = [];
  const armStrips = [];


  // 1. ── Foundation + faceted illuminated base ───────────────────────────────
  const foundation = new THREE.Mesh(new THREE.CylinderGeometry(12.4, 12.8, 0.4, 48), baseConcreteMat);
  foundation.position.y = 0.2; foundation.receiveShadow = true;
  group.add(foundation);

  // Hollow outer base skirt wall (open-ended)
  const baseSkirt = new THREE.Mesh(new THREE.CylinderGeometry(10.6, 11.4, 1.4, 48, 1, true), baseHousingMat);
  baseSkirt.position.y = 0.85; baseSkirt.castShadow = true; baseSkirt.receiveShadow = true;
  group.add(baseSkirt);

  // Ring-shaped top cover of the base skirt with a central well opening
  const baseSkirtTop = new THREE.Mesh(new THREE.RingGeometry(3.5, 10.6, 48), baseHousingMat);
  baseSkirtTop.rotation.x = -Math.PI / 2;
  baseSkirtTop.position.y = 1.55; // Aligned with the top of the skirt wall
  baseSkirtTop.receiveShadow = true; baseSkirtTop.castShadow = true;
  group.add(baseSkirtTop);

  // Gold trim rings around the skirt
  for (const yy of [0.25, 1.5]) {
    const trim = new THREE.Mesh(new THREE.TorusGeometry(11.0, 0.12, 10, 64), goldMat);
    trim.rotation.x = Math.PI / 2; trim.position.y = yy; trim.castShadow = true;
    group.add(trim);
  }

  // Illuminated arched panels around the base skirt
  const panelCount = 16;
  for (let i = 0; i < panelCount; i++) {
    const a = (i / panelCount) * Math.PI * 2;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.5), neon(i % 2 ? 0x12c2ff : 0xff3cac));
    panel.position.set(Math.cos(a) * 11.05, 0.85, Math.sin(a) * 11.05);
    panel.rotation.y = -a;
    group.add(panel);
    basePanels.push(panel);
  }

  // Motor mounting housing + chrome cap (low profile at the base)
  const motorBase = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.1, 32), baseHousingMat);
  motorBase.position.y = 0.45; motorBase.castShadow = true; motorBase.receiveShadow = true;
  group.add(motorBase);
  const motorCap = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.04, 32), chromeMat);
  motorCap.position.y = 0.51; motorCap.castShadow = true;
  group.add(motorCap);

  // Marquee crown — a ring of chase bulbs on top of the outer base skirt
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const bulb = createEmissiveBulb(0xfff1c0, 0.13, 0.3);
    // Position on top of the base skirt (skirt top is at y = 1.55)
    bulb.position.set(Math.cos(a) * 10.8, 1.55, Math.sin(a) * 10.8);
    group.add(bulb);
    rimBulbs.push(bulb);
  }

  const pivotCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.1, 24), goldMat);
  pivotCollar.position.y = ARM_PIVOT_Y; pivotCollar.castShadow = true;
  group.add(pivotCollar);

  // Anchor studs around the foundation rim
  const anchorGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.16, 8);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const anchor = new THREE.Mesh(anchorGeo, chromeMat);
    anchor.position.set(Math.cos(a) * 11.6, 0.22, Math.sin(a) * 11.6);
    group.add(anchor);
  }

  // 2. ── Arm pivot ───────────────────────────────────────────────────────────
  const armPivot = new THREE.Group();
  armPivot.name = 'tagada_arm_pivot';
  armPivot.position.set(0, ARM_PIVOT_Y, 0);
  group.add(armPivot);

  // Mechanical yoke base — a torus ring so the arm passes cleanly through the centre
  const yokeBase = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.28, 12, 32), metalPedestalMat);
  yokeBase.rotation.x = Math.PI / 2;
  yokeBase.position.y = -0.4;
  armPivot.add(yokeBase);

  // Mechanical fork arms (yoke stanchions) - rotate horizontally but do NOT tilt
  const bracketGeo = new THREE.BoxGeometry(0.35, 0.7, 0.9);
  for (const sx of [-1, 1]) {
    const bracket = new THREE.Mesh(bracketGeo, metalPedestalMat);
    bracket.position.set(sx * 1.05, -0.05, 0);
    armPivot.add(bracket);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), chromeMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sx * 1.24, -0.05, 0);
    armPivot.add(cap);
  }

  // The tilting group (pitch/roll) inside the yaw pivot
  const armTilt = new THREE.Group();
  armTilt.name = 'tagada_arm_tilt';
  armTilt.rotation.order = 'XYZ';
  armPivot.add(armTilt);

  // Hinge pin (tilts with the arm)
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 2.0, 24), darkChromeMat);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, -0.05, 0);
  armTilt.add(hinge);

  // 3. ── Arm ─────────────────────────────────────────────────────────────────
  const armLength = 9.0;
  const armGroup = new THREE.Group();
  armGroup.name = 'tagada_arm_group';
  armTilt.add(armGroup);

  // Large mechanical ball joint socket at the main pivot (fixed to the base)
  const mainBall = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), darkChromeMat);
  mainBall.position.set(0, ARM_PIVOT_Y, 0);
  mainBall.castShadow = true;
  group.add(mainBall);

  // Rubber bellows boot — hides the arm-to-housing junction (starts above pivot, goes up)
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85, metalness: 0.1 });
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.88, 1.2, 20), bootMat);
  boot.position.y = 0.6;
  armGroup.add(boot);

  const armGeo = new THREE.CylinderGeometry(0.45, 0.62, armLength, 24);
  armGeo.translate(0, armLength / 2, 0); // moves origin to the bottom of the cylinder
  const mainArm = new THREE.Mesh(armGeo, armMat);
  mainArm.position.set(0, 0, 0); // Position is permanently locked at the pivot (0,0,0)
  mainArm.castShadow = true; mainArm.receiveShadow = true;
  armGroup.add(mainArm);

  // Gold collars along the arm (children of mainArm, so they telescope automatically)
  for (const t of [0.18, 0.5, 0.82]) {
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.22, 24), goldMat);
    collar.position.set(0, armLength * t, 0);
    collar.castShadow = true;
    mainArm.add(collar);
  }

  // Cyan LED strips running up two sides of the arm (children of mainArm, so they telescope automatically)
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, armLength * 0.92, 0.16), neon(0x19e6ff));
    strip.position.set(sx * 0.5, armLength * 0.5, 0.3);
    mainArm.add(strip);
    armStrips.push(strip);
  }

  // 4. ── Disc pivot (tilts/bumps with the arm, does NOT spin) ─────────────────
  const discPivot = new THREE.Group();
  discPivot.name = 'tagada_disc_pivot';
  discPivot.position.set(0, armLength, 0);
  armGroup.add(discPivot);

  // Main drive shaft connector (connects the arm to the platform, visible through hollow underbelly)
  const connector = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.5, 24), darkChromeMat);
  connector.position.y = -0.75; // spans from y = -1.5 to y = 0
  connector.castShadow = true;
  discPivot.add(connector);

  // 5. ── Spinning disc mesh group ────────────────────────────────────────────
  const discMeshGroup = new THREE.Group();
  discMeshGroup.name = 'tagada_disc_mesh';
  discPivot.add(discMeshGroup);

  const discRadius = 7.0;
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(discRadius, discRadius, 0.45, 64), platformMat);
  platform.receiveShadow = true; platform.castShadow = true;
  discMeshGroup.add(platform);

  // Decorative underbelly (hollow truncated cone with a central opening for the connector shaft)
  // Matte crimson (not metal) so it reads as a bright colour rather than mirroring the dark ground.
  const underMat = new THREE.MeshStandardMaterial({ color: 0xb0203f, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide });
  const underBowl = new THREE.Mesh(new THREE.CylinderGeometry(discRadius * 0.98, 1.8, 1.4, 48, 1, true), underMat);
  underBowl.position.y = -0.225 - 0.7; // fits against the platform bottom
  discMeshGroup.add(underBowl);
  // gold rim trim + glowing LED ring at the underbelly's widest edge (just below the deck)
  const underTrim = new THREE.Mesh(new THREE.TorusGeometry(discRadius * 0.98, 0.13, 10, 64), goldMat);
  underTrim.rotation.x = Math.PI / 2; underTrim.position.y = -0.28;
  discMeshGroup.add(underTrim);
  const underLed = new THREE.Mesh(new THREE.TorusGeometry(discRadius * 0.86, 0.07, 10, 64), neon(0xffd54a));
  underLed.rotation.x = Math.PI / 2; underLed.position.y = -0.7;
  discMeshGroup.add(underLed);
  ledRings.push(underLed);
  // radial gold spoke ribs across the underbelly
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(discRadius * 0.92, 0.12, 0.14), goldMat);
    rib.position.set(Math.cos(a) * discRadius * 0.46, -0.5, Math.sin(a) * discRadius * 0.46);
    rib.rotation.y = -a;
    discMeshGroup.add(rib);
  }

  // Stacked chrome / gold rim with an embedded LED band
  const rimChrome = new THREE.Mesh(new THREE.CylinderGeometry(discRadius + 0.12, discRadius + 0.12, 0.55, 64), chromeMat);
  rimChrome.castShadow = true;
  discMeshGroup.add(rimChrome);
  const rimGold = new THREE.Mesh(new THREE.CylinderGeometry(discRadius + 0.16, discRadius + 0.16, 0.16, 64), goldMat);
  rimGold.position.y = 0.32;
  discMeshGroup.add(rimGold);

  // Two emissive LED rings hugging the rim
  for (const [ry, col] of [[0.12, 0x12c2ff], [-0.12, 0xff3cac]]) {
    const led = new THREE.Mesh(new THREE.TorusGeometry(discRadius + 0.18, 0.07, 10, 96), neon(col));
    led.rotation.x = Math.PI / 2; led.position.y = ry;
    discMeshGroup.add(led);
    ledRings.push(led);
  }

  // Central chrome hub with a ring of glowing decorative gems wrapping around the mast
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.5, 0.7, 32), chromeMat);
  hub.position.y = 0.35; hub.castShadow = true;
  discMeshGroup.add(hub);

  const gemMat = neon(0x6cf0ff); gemMat.metalness = 0.3; gemMat.roughness = 0.1;
  const gemGroup = new THREE.Group();
  gemGroup.name = 'tagada_gems_ring';
  discMeshGroup.add(gemGroup);

  const gemCount = 8;
  const gemRadius = 0.72;
  for (let i = 0; i < gemCount; i++) {
    const a = (i / gemCount) * Math.PI * 2;
    const g = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), gemMat);
    g.position.set(gemRadius * Math.cos(a), 0.8, gemRadius * Math.sin(a));
    g.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    gemGroup.add(g);
    ledRings.push(g); // pulse with the LED rings
  }
  const gem = gemGroup;

  // 6. ── Perimeter handrail ──────────────────────────────────────────────────
  const railHeight = 1.1;
  const railRadius = discRadius - 0.25;
  const handrail = new THREE.Mesh(new THREE.TorusGeometry(railRadius, 0.06, 10, 64), railMat);
  handrail.rotation.x = Math.PI / 2; handrail.position.y = railHeight; handrail.castShadow = true;
  discMeshGroup.add(handrail);
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, railHeight, 8);
  for (let i = 0; i < 24; i++) {
    if (i === 0) continue; // entrance gap
    const a = (i / 24) * Math.PI * 2;
    const pole = new THREE.Mesh(poleGeo, railMat);
    pole.position.set(railRadius * Math.cos(a), railHeight / 2, railRadius * Math.sin(a));
    pole.castShadow = true;
    pole.layers.enable(2);
    discMeshGroup.add(pole);
  }

  // Rim bulbs around the platform edge (alternating chase)
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const bulb = createEmissiveBulb(i % 2 ? 0xfff1c0 : 0x12c2ff, 0.12, 0.3);
    bulb.position.set((discRadius + 0.2) * Math.cos(a), 0.42, (discRadius + 0.2) * Math.sin(a));
    discMeshGroup.add(bulb);
    rimBulbs.push(bulb);
  }

  // 7. ── Grand parasol canopy (on discPivot, so it tilts but doesn't spin) ────
  const canopy = new THREE.Group();
  canopy.name = 'tagada_canopy';
  discPivot.add(canopy);

  const MAST_TOP = 5.0;
  const mastHeight = 8.1;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, mastHeight, 24), chromeMat);
  mast.position.y = mastHeight / 2 + 0.4; mast.castShadow = true;
  canopy.add(mast);
  // gold spiral collars on the mast
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 8, 24), goldMat);
    c.rotation.x = Math.PI / 2; c.position.y = 0.9 + i * 0.95;
    canopy.add(c);
  }

  const CANOPY_GORES = 12;
  const canopyR = 8.4, canopyH = 3.1, canopyBaseY = MAST_TOP + 0.4;
  const dome = new THREE.Mesh(new THREE.ConeGeometry(canopyR, canopyH, CANOPY_GORES, 1, true), canopyMat);
  dome.position.y = canopyBaseY + canopyH / 2;
  dome.castShadow = false; // don't shade the deck black — the parasol fully covers it
  canopy.add(dome);
  // gold under-trim ring at the hem
  const hemRing = new THREE.Mesh(new THREE.TorusGeometry(canopyR, 0.14, 10, CANOPY_GORES * 2), goldMat);
  hemRing.rotation.x = Math.PI / 2; hemRing.position.y = canopyBaseY;
  canopy.add(hemRing);

  // Ribs along the 12 gore edges + a bulb and a hanging pennant at each hem point
  const apex = new THREE.Vector3(0, canopyBaseY + canopyH, 0);
  const pennants = [];
  for (let i = 0; i < CANOPY_GORES; i++) {
    const a = (i / CANOPY_GORES) * Math.PI * 2;
    const hem = new THREE.Vector3(Math.cos(a) * canopyR, canopyBaseY, Math.sin(a) * canopyR);
    // rib
    const ribLen = apex.distanceTo(hem);
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, ribLen, 8), goldMat);
    rib.position.copy(apex.clone().add(hem).multiplyScalar(0.5));
    rib.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hem.clone().sub(apex).normalize());
    canopy.add(rib);
    // small bulbs running up the rib + a larger one at the hem
    for (const tt of [0.35, 0.6, 0.82]) {
      const rb = createEmissiveBulb(0xfff1c0, 0.08, 0.3);
      rb.position.copy(apex.clone().lerp(hem, tt));
      canopy.add(rb);
      canopyBulbs.push(rb);
    }
    const bulb = createEmissiveBulb(0xfff1c0, 0.12, 0.3);
    bulb.position.copy(hem); bulb.position.y -= 0.05;
    canopy.add(bulb);
    canopyBulbs.push(bulb);
    // hanging triangular pennant between this hem point and the next
    const a2 = ((i + 1) / CANOPY_GORES) * Math.PI * 2;
    const hem2 = new THREE.Vector3(Math.cos(a2) * canopyR, canopyBaseY, Math.sin(a2) * canopyR);
    const mid = hem.clone().add(hem2).multiplyScalar(0.5);
    const pennShape = new THREE.Shape();
    const w = hem.distanceTo(hem2) * 0.5;
    pennShape.moveTo(-w, 0); pennShape.lineTo(w, 0); pennShape.lineTo(0, -0.85); pennShape.lineTo(-w, 0);
    const penn = new THREE.Mesh(new THREE.ShapeGeometry(pennShape),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x12c2ff : 0xffd54a, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 }));
    penn.position.copy(mid); penn.position.y = canopyBaseY - 0.02;
    penn.lookAt(0, canopyBaseY - 0.02, 0); // face outward
    canopy.add(penn);
    pennants.push(penn);
  }

  // Finial — chrome ball + glowing star on top of the canopy
  const finialPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 12), goldMat);
  finialPost.position.y = apex.y + 0.4;
  canopy.add(finialPost);
  const finialBall = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), chromeMat);
  finialBall.position.y = apex.y + 0.95;
  canopy.add(finialBall);
  const starMat = neon(0xffe27a); starMat.emissiveIntensity = 0.6;
  const finialStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), starMat);
  finialStar.position.y = apex.y + 1.7;
  canopy.add(finialStar);

  // Warm light under the canopy that switches on at night to glow the deck + riders.
  const canopyLight = createPointLight(0xffd9a0, 0.0, 26, 2.0);
  canopyLight.position.set(0, canopyBaseY - 0.6, 0);
  canopyLight.layers.set(2);
  canopy.add(canopyLight);

  // String lights draped from the finial down to each hem bulb
  const stringMat = neon(0xfff1c0);
  for (let i = 0; i < CANOPY_GORES; i++) {
    const a = (i / CANOPY_GORES) * Math.PI * 2;
    const hem = new THREE.Vector3(Math.cos(a) * (canopyR + 0.05), canopyBaseY + 0.1, Math.sin(a) * (canopyR + 0.05));
    const top = new THREE.Vector3(0, apex.y + 0.2, 0);
    const len = top.distanceTo(hem);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 5), darkChromeMat);
    wire.position.copy(top.clone().add(hem).multiplyScalar(0.5));
    wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hem.clone().sub(top).normalize());
    canopy.add(wire);
  }

  // Festoon swags — drooping strings of coloured bulbs looping between each hem point.
  const festoonBulbs = [];
  const festoonColors = [0xff4d6d, 0x4dd2ff, 0xffe27a, 0x8aff7a, 0xc77dff];
  const festoonWireMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.7, metalness: 0.3 });
  for (let i = 0; i < CANOPY_GORES; i++) {
    const a1 = (i / CANOPY_GORES) * Math.PI * 2;
    const a2 = ((i + 1) / CANOPY_GORES) * Math.PI * 2;
    const hemA = new THREE.Vector3(Math.cos(a1) * (canopyR + 0.12), canopyBaseY - 0.08, Math.sin(a1) * (canopyR + 0.12));
    const hemB = new THREE.Vector3(Math.cos(a2) * (canopyR + 0.12), canopyBaseY - 0.08, Math.sin(a2) * (canopyR + 0.12));
    const segs = 6, sag = 1.35;
    const pts = [];
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const p = new THREE.Vector3().lerpVectors(hemA, hemB, t);
      p.y -= Math.sin(Math.PI * t) * sag; // parabolic droop
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, segs * 2, 0.022, 5, false), festoonWireMat);
    canopy.add(wire);
    for (let k = 1; k < segs; k++) {
      const b = createEmissiveBulb(festoonColors[(i + k) % festoonColors.length], 0.12, 0.3);
      b.position.copy(pts[k]);
      canopy.add(b);
      festoonBulbs.push(b);
    }
  }

  // 8. ── Seats & Passengers ──────────────────────────────────────────────────
  const seats = [];
  const seatRadius = discRadius - 1.1;
  const currentHumanHeight = getPassengerWorldHeight();
  const riderHeight = currentHumanHeight * 0.88;
  const seatLeds = []; // glowing seat-edge strips, animated + recolourable at night

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const seatColor = SEAT_COLORS[i % SEAT_COLORS.length];
    const seatMat = new THREE.MeshStandardMaterial({ color: seatColor, roughness: 0.5, metalness: 0.15 });

    const seatGroup = new THREE.Group();
    seatGroup.name = `seat_group_${i}`;
    seatGroup.position.set(seatRadius * Math.cos(angle), 0.225, seatRadius * Math.sin(angle));
    seatGroup.lookAt(0, 0.225, 0);
    discMeshGroup.add(seatGroup);

    const seatSurfaceY = 0.80;
    const baseHeight = 0.65;

    // ── Open padded bench seat ──
    // A real Tagada seat: a padded pan + contoured back + low hip bolsters + a grab rail. Deliberately
    // OPEN (no enclosing shell) so the riders' waving arms and dangling legs never clip through it.
    // Seat pan with a rounded front nose.
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.24, 0.98), seatMat);
    cushion.position.set(0, 0.74, 0.06); cushion.castShadow = true; cushion.receiveShadow = true;
    seatGroup.add(cushion);
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.34, 16), seatMat);
    nose.rotation.z = Math.PI / 2; nose.position.set(0, 0.74, 0.55); nose.castShadow = true;
    seatGroup.add(nose);

    // Contoured padded backrest (to shoulder height, open sides) + chrome top rail + slim headrest.
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(1.34, 1.0, 0.18), seatMat);
    backrest.position.set(0, seatSurfaceY + 0.5, -0.44); backrest.rotation.x = -0.08; backrest.castShadow = true;
    seatGroup.add(backrest);
    const backRail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 12), chromeMat);
    backRail.rotation.z = Math.PI / 2; backRail.position.set(0, seatSurfaceY + 1.02, -0.46); backRail.castShadow = true;
    seatGroup.add(backRail);
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.16), seatMat);
    headrest.position.set(0, seatSurfaceY + 1.2, -0.46); headrest.castShadow = true;
    seatGroup.add(headrest);

    // Low hip bolsters (top out below the arms, so raised arms clear them) with chrome caps.
    for (const side of [-1, 1]) {
      const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.92), seatMat);
      bolster.position.set(side * 0.66, 0.92, 0.06); bolster.castShadow = true;
      seatGroup.add(bolster);
      const bolsterCap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.92, 12), chromeMat);
      bolsterCap.rotation.x = Math.PI / 2; bolsterCap.position.set(side * 0.66, 1.1, 0.06);
      seatGroup.add(bolsterCap);
    }

    // Dark frame pod beneath + gold trim band.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, baseHeight, 0.92), seatFrameMat);
    frame.position.set(0, baseHeight / 2, 0.02); frame.castShadow = true;
    seatGroup.add(frame);
    const frameTrim = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.1, 0.96), goldMat);
    frameTrim.position.set(0, baseHeight - 0.04, 0.02);
    seatGroup.add(frameTrim);

    // ── Padded grab bar with hand grips + glowing themed badge ──
    // Sits at lap height toward the disc centre (+Z): above the knees, below eye level — it frames the
    // FPV foreground like a real ride bar without catching the legs or blocking the view.
    const restraint = new THREE.Group();
    seatGroup.add(restraint);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.55, metalness: 0.25 });
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.66, 10);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, chromeMat);
      post.position.set(side * 0.56, seatSurfaceY + 0.18, 0.4); post.rotation.x = 0.4; post.castShadow = true;
      restraint.add(post);
    }
    const grabBar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.18, 12), chromeMat);
    grabBar.rotation.z = Math.PI / 2; grabBar.position.set(0, seatSurfaceY + 0.46, 0.56); grabBar.castShadow = true;
    restraint.add(grabBar);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.58, 12), padMat);
    grip.rotation.z = Math.PI / 2; grip.position.set(0, seatSurfaceY + 0.46, 0.56);
    restraint.add(grip);
    for (const side of [-1, 1]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), padMat);
      knob.position.set(side * 0.33, seatSurfaceY + 0.46, 0.56);
      restraint.add(knob);
    }
    const badgeMat = neon(seatColor); badgeMat.emissiveIntensity = 0.2;
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), badgeMat);
    badge.position.set(0, seatSurfaceY + 0.46, 0.615);
    restraint.add(badge); seatLeds.push(badge);

    // Glowing LED accents — backrest top edge + seat-base front lip (themed, recoloured, animated).
    const ledMat = neon(seatColor); ledMat.emissiveIntensity = 0.2;
    const ledBack = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 0.05), ledMat);
    ledBack.position.set(0, seatSurfaceY + 0.98, -0.35); seatGroup.add(ledBack); seatLeds.push(ledBack);
    const ledFront = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.05, 0.05), ledMat);
    ledFront.position.set(0, 0.62, 0.56); seatGroup.add(ledFront); seatLeds.push(ledFront);

    // Add Passenger (seating logic unchanged — it is calibrated to the cushion height)
    let rider = null;
    if (visitors && visitors.length > 0) {
      const template = visitors[i % visitors.length];
      rider = makeRider(template, riderHeight, { pool: TAGADA_ACTIONS, facingY: 0, phase: i * 1.3 });

      // The model's root bone already has the correct bind-pose orientation:
      // head above hips (right-side-up) and facing +Z (toward the disc centre).
      // Unlike the Coaster (which inverts the cart 180° around X), the Tagada
      // seat frame matches the model's default orientation — no flip needed.
      const targetZ = 0.54; // hips at the front edge of the cushion so legs hang freely in front
      const scale = riderHeight / template.height;

      positionRiderOnHip(rider, template, new THREE.Vector3(0.0, seatSurfaceY, targetZ), scale);

      rider.restX = rider.pivot.position.x;
      rider.restY = rider.pivot.position.y;
      rider.restZ = rider.pivot.position.z;
      rider.height = riderHeight; // needed by the FPV camera math in main.js (else head Y = NaN)
      seatGroup.add(rider.pivot);
    }

    seats.push({ group: seatGroup, rider });

    // ── FPV camera-rig: positioned at the rider's head, in seatGroup-local.
    //    Seat-local +Z is already toward the disc centre (the rider's forward
    //    direction — see comment at line 656-659), so NO Y-flip is needed: the
    //    rig's local -Z naturally points outward (over the rim) and +Z points
    //    inward (toward the centre), matching how the rider faces.
    //    Inherits the disc spin and the seat's tilt from the parent transforms.
    if (rider) {
      const cameraRig = new THREE.Group();
      cameraRig.name = 'cameraRig';
      cameraRig.position.set(
        rider.pivot.position.x,
        rider.pivot.position.y + rider.height * 0.82,
        rider.pivot.position.z + 0.15
      );
      seatGroup.add(cameraRig);
      seats[seats.length - 1].cameraRig = cameraRig;
    }
  }

  // 8. Emissive Blinking Bulbs for night lighting
  const bulbs = [];
  const bulbColors = [0xff00ff, 0x00ffff, 0xffff00, 0xff3300, 0x33ff00];

  const bulbCount = 16;
  for (let i = 0; i < bulbCount; i++) {
    const angle = (i / bulbCount) * Math.PI * 2;
    const color = bulbColors[i % bulbColors.length];
    const bulb = createEmissiveBulb(color, 0.1, 0.0);
    // Positioned on the chrome outer rim just below handrail height
    bulb.position.set((discRadius + 0.06) * Math.cos(angle), 0.3, (discRadius + 0.06) * Math.sin(angle));
    bulb.layers.enable(2);
    discMeshGroup.add(bulb);
    bulbs.push(bulb);
  }

  const ridePointLights = [];
  
  // Central Disc Light
  const centerLight = createPointLight(0xff00ff, 0, 45, 1.2);
  centerLight.position.set(0, 1.5, 0);
  centerLight.layers.set(2);
  discMeshGroup.add(centerLight);
  ridePointLights.push(centerLight);

  // Rim Lights (reduced to 2 for performance, using light layers)
  for (let i = 0; i < 2; i++) {
    const angle = (i / 2) * Math.PI * 2;
    const pl = createPointLight(0xff00ff, 0, 45, 1.5);
    pl.position.set((discRadius + 0.06) * Math.cos(angle), 0.3, (discRadius + 0.06) * Math.sin(angle));
    pl.layers.set(2);
    discMeshGroup.add(pl);
    ridePointLights.push(pl);
  }

  const tagadaColor = new THREE.Color(0xff00ff);

  // 9. ── Control Panel ────────────────────────────────────────────────────────
  const controlPanel = buildControlPanel({ initialRunning: true });
  controlPanel.group.position.set(12, 0, -12);
  group.add(controlPanel.group);
  group.updateMatrixWorld(true);
  controlPanel.group.lookAt(position[0], position[1], position[2]);
  controlPanel.group.rotateY(Math.PI);

  // 10. ── Controller ──────────────────────────────────────────────────────────
  const controller = new TagadaController(group, armPivot, discMeshGroup, seats);
  controller.panel = controlPanel.group;

  // Bridge controller state to ControlPanel
  controlPanel.group.updateState = (running) => {
    if (controlPanel.running !== running) {
      controlPanel.toggle();
    }
  };

  controller.addEventBusListener('color-change', (hex) => {
    const target = new THREE.Color(hex);
    const tween = new TWEEN.Tween(tagadaColor)
      .to(target, 500)
      .easing(Easings.COLOR)
      .onUpdate(() => {
        const tint = (m) => { m.color.copy(tagadaColor); m.emissive.copy(tagadaColor); };
        bulbs.forEach(b => tint(b.material));
        canopyBulbs.forEach(b => tint(b.material));
        rimBulbs.forEach(b => tint(b.material));
        ledRings.forEach(b => tint(b.material));
        basePanels.forEach(b => tint(b.material));
        festoonBulbs.forEach(b => tint(b.material));
        seatLeds.forEach(b => tint(b.material));
        armStrips.forEach(b => tint(b.material));
        ridePointLights.forEach(pl => pl.color.copy(tagadaColor));
      });
    controller.trackTween(tween);
    tween.start();
  });

  group.userData.tick = (delta, time) => {
    const { ease, speedMult } = controller.tickSpeed(controlPanel, delta);
    controller.spinAngle += controller.maxSpeed * ease * speedMult * delta;
    controller.pitchAngle += PITCH_FREQ * ease * speedMult * delta;
    controller.rollAngle += ROLL_FREQ * ease * speedMult * delta;
    controller.bumpAngle += BUMP_FREQ * ease * speedMult * delta;
    controller.armYawAngle += ARM_YAW_SPEED * ease * speedMult * delta;

    const idleEase = 1 - ease;

    discMeshGroup.rotation.y = controller.spinAngle;

    armPivot.rotation.y = controller.armYawAngle;

    // Apply the main pitch/roll and bump rotations directly to armTilt so the entire
    // arm and platform shake together, keeping the upper connector coaxial with the main arm.
    const runningPitch = BASE_PITCH + PITCH_AMP * Math.sin(controller.pitchAngle);
    const runningRoll = ROLL_AMP * Math.sin(controller.rollAngle);
    const bumpX = Math.sin(controller.bumpAngle) * BUMP_AMP * ease;
    const bumpZ = Math.cos(controller.bumpAngle * 0.9) * (BUMP_AMP * 0.5) * ease;

    armTilt.rotation.x = runningPitch * ease + bumpX;
    armTilt.rotation.z = runningRoll * ease + bumpZ;

    // Platform telescoping (arm scale and discPivot translation)
    // The bottom of mainArm is locked at (0,0,0) in armGroup space because its geometry
    // was translated, so scaling only extends/retracts it from the pivot without shifting the base.
    const targetArmLength = Math.max(MIN_ARM_LENGTH, armLength - BOARDING_DROP * idleEase);
    const armScale = targetArmLength / armLength;
    mainArm.scale.set(1, armScale, 1);
    discPivot.position.y = targetArmLength;

    // discPivot has no local tilt/bump rotation now, keeping it perfectly aligned with the arm
    discPivot.rotation.x = 0;
    discPivot.rotation.z = 0;

    // Update world matrices of the hierarchy so getWorldPosition is accurate
    group.updateMatrixWorld(true);

    // Passenger poses + dynamics: each body hangs on a damped vertical spring
    // driven by the REAL seat acceleration (pitch/roll/bump of the platform),
    // so riders lag the plate and bounce on the bumps instead of random jitter.
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if (!s.rider) continue;
      updateRider(s.rider, time + s.rider.phase);
      const B = s.rider.bones;
      applyChairSeatedLegs(B, s.rider.scale);

      const t = time + i * 1.3;
      const variant = i % 4;
      const arm = (name, dx, dy, dz) => { if (B[name]) pose(B, name, dx * ease, dy * ease, dz * ease); };
      if (ease >= 0.02) {
        if (variant === 0 || variant === 3) {
          const pump = Math.sin(t * 4.0) * 0.12;
          arm('UpperArmR', 0.2 + pump, 2.2, -0.2); arm('UpperArmL', -0.2 - pump, -2.2, 0.2);
          arm('LowerArmR', 0.8, 0, 0); arm('LowerArmL', 0.8, 0, 0);
        } else if (variant === 1) {
          arm('UpperArmR', 0.2, 1.9, -0.2); arm('LowerArmR', 1.1, Math.sin(t * 8) * 0.35, Math.sin(t * 8) * 0.35);
          arm('UpperArmL', 0.5, -0.3, 0); arm('LowerArmL', 0.8, 0, 0);
        } else {
          arm('UpperArmR', 0.1, 1.5 + Math.sin(t * 2.5) * 0.1, 0); arm('LowerArmR', 0.3, 0, 0);
          arm('UpperArmL', 0.5 + Math.sin(t * 2) * 0.06, -0.4, 0); arm('LowerArmL', 0.7, 0, 0);
        }
      }
      if (B.Torso) { const tb = B.Torso.bone; tb.rotation.x += -0.15 * ease; tb.rotation.z += Math.sin(t * 1.5) * 0.05 * ease; }
      if (B.Head) { const hb = B.Head.bone; hb.rotation.x += -0.15 * ease; hb.rotation.y += Math.sin(t * 2.0) * 0.08 * ease; }

      // Simple Math.sin bounce aligned with lecture ride pattern
      const bounce = Math.sin(time * 3.0 + i * 0.8) * 0.08 * ease;
      const jitterX = Math.sin(time * JITTER_FREQ + i * 2.1) * JITTER_AMP * 0.5 * ease;
      s.rider.pivot.position.set(s.rider.restX + jitterX, s.rider.restY + bounce, s.rider.restZ);
      s.rider.pivot.rotation.x = Math.sin(time * 2.5 + i * 1.2) * 0.08 * ease;
      s.rider.pivot.rotation.z = Math.cos(time * JITTER_FREQ * 0.8 + i * 1.4) * 0.04 * ease;
    }

    // ── Light show: smooth day↔night, with chase / pulse patterns ─────────────
    const isNight = isNightNow(group);
    controller.nightMix = nightMixLerp(controller.nightMix, isNight, delta, 2.2);
    const nf = controller.nightMix;

    // Bulbs + ride point lights
    if (isNight) {
      bulbs.forEach((b, idx) => {
        const pulse = Math.sin(time * 6.0 + idx * 0.5) * 0.5 + 0.5;
        b.material.emissiveIntensity = 1.2 + pulse * 2.0;
      });
      ridePointLights.forEach((pl, idx) => {
        const isCenter = idx === 0;
        const pulse = Math.sin(time * 5.0 + idx * 1.6) * 0.5 + 0.5;
        pl.intensity = isCenter ? (1.2 + pulse * 0.5) * 120.0 : (1.2 + pulse * 2.0) * 35.0;
      });
    } else {
      bulbs.forEach((b) => { b.material.emissiveIntensity = 0.0; });
      ridePointLights.forEach((pl) => { pl.intensity = 0.0; });
    }

    // Canopy hem bulbs — rotating chase
    for (let i = 0; i < canopyBulbs.length; i++) {
      const chase = 0.5 + 0.5 * Math.sin(time * 7.0 - i * (Math.PI * 2 / canopyBulbs.length) * 3);
      canopyBulbs[i].material.emissiveIntensity = 0.18 + nf * (0.4 + chase * 2.4);

    }
    // Rim + crown bulbs — alternating twinkle
    for (let i = 0; i < rimBulbs.length; i++) {
      const on = (Math.floor(time * 5) + i) % 2 === 0 ? 1 : 0;
      rimBulbs[i].material.emissiveIntensity = 0.12 + nf * (on ? 2.6 : 0.25);
    }
    // LED rings + gem — smooth colour pulse
    for (let i = 0; i < ledRings.length; i++) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + i * 1.3);
      ledRings[i].material.emissiveIntensity = 0.25 + nf * (0.9 + pulse * 1.9);
    }
    // Base arched panels — slow breathing glow
    for (let i = 0; i < basePanels.length; i++) {
      const breathe = 0.5 + 0.5 * Math.sin(time * 1.4 + i * 0.4);
      basePanels[i].material.emissiveIntensity = 0.12 + nf * (0.5 + breathe * 1.3);
    }
    // Festoon swag bulbs — colourful rotating chase
    for (let i = 0; i < festoonBulbs.length; i++) {
      const chase = 0.5 + 0.5 * Math.sin(time * 6.0 - i * 0.5);
      festoonBulbs[i].material.emissiveIntensity = 0.15 + nf * (0.5 + chase * 2.6);
    }
    // Seat-edge LEDs — gentle synchronized pulse
    for (let i = 0; i < seatLeds.length; i++) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.0 + i * 0.8);
      seatLeds[i].material.emissiveIntensity = 0.2 + nf * (0.9 + pulse * 1.7);
    }
    // Arm strips
    for (const s of armStrips) s.material.emissiveIntensity = 0.2 + nf * 1.6;
    // Canopy fabric glows softly at night; warm under-light fades in
    canopyMat.emissiveIntensity = nf * 0.5;
    canopyLight.intensity = nf * 1.6;
    // Finial star — always sparkles, spins gently
    starMat.emissiveIntensity = 0.5 + nf * 2.2 + Math.sin(time * 5) * 0.2;
    finialStar.rotation.y += delta * 0.7;
    gem.rotation.y += delta * 1.1 * ease;
  };

  void camera; void renderer;

  controller.applyBloomLayers();

  group.userData.controller = controller;
  return group;
}
