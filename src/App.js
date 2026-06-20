import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { Easings } from './utils/Easings.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildGround } from './environment/Ground.js';
import { buildPaths } from './environment/Paths.js';
import { buildSky } from './environment/Sky.js';
import { buildLights } from './lighting/LightManager.js';
import { buildFence } from './environment/Fence.js';
import { buildLampposts } from './environment/Lampposts.js';
import { buildFoodStalls } from './environment/FoodStalls.js';
import { buildStage } from './environment/Stage.js';
import { buildVegetation } from './environment/Vegetation.js';
import { buildBenches } from './environment/Benches.js';
import { buildEntranceGate } from './environment/Props.js';
import { buildRiver } from './environment/River.js';
import { buildFerrisWheel } from './rides/FerrisWheel.js';
import { buildCarousel } from './rides/Carousel.js';
import { buildTagada } from './rides/Tagada.js';
import { buildCoaster } from './rides/Coaster.js';
import { buildBalloon } from './rides/Balloon.js';
import { buildTrain } from './rides/Train.js';
import { buildShootingGallery } from './rides/ShootingGallery.js';
import { buildRideSign } from './ui/RideSign.js';
import { buildRideHint } from './ui/RideHints.js';
import { buildVisitors } from './people/Visitors.js';
import { buildFireworks } from './environment/Fireworks.js';
import { DayNightCycle, isNightNow } from './lighting/DayNightCycle.js';
import { CameraManager } from './controls/CameraManager.js';
import { eventBus } from './utils/EventBus.js';
import { InteractionManager } from './controls/InteractionManager.js';
import { buildHud } from './ui/Hud.js';
import { buildRideHotbar } from './ui/RideHotbar.js';

const canvas = document.getElementById('c');
const loaderEl = document.getElementById('loader');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(60, 45, 80);
camera.lookAt(0, 0, 0);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.4, 0.85);
bloomPass.threshold = 1.5;
bloomPass.strength = 0.35;
bloomPass.radius = 0.4;
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

const clock = new THREE.Clock();

const fpsEl = document.getElementById('fps');
let fpsFrames = 0;
let fpsLastTime = performance.now();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 5;
controls.maxDistance = 250;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 1, 0);

const environmentGroup = new THREE.Group();
environmentGroup.name = 'environment';
scene.add(environmentGroup);

const windInput = document.getElementById('wind');
const windValEl = document.getElementById('windVal');
if (windInput && windValEl) {
  windInput.addEventListener('input', () => {
    windValEl.textContent = parseFloat(windInput.value).toFixed(2);
  });
}

let dayNight = null;
let rideSigns = [];
let rideHints = [];
let cameraManager = null;
const fpvTmpVec = new THREE.Vector3();
const fpvTmpQuat = new THREE.Quaternion();
const world = {};
let balloons = []; // populated in init(), referenced by the CameraManager rides callback
let hud;

cameraManager = new CameraManager(camera, scene, controls, renderer, () => {
  const rides = [];
  environmentGroup.traverse((node) => {
    if (node.userData && node.userData.controller) {
      rides.push(node);
    }
  });
  return rides;
});

let autoAdvance = true;

async function init() {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const skyInfo = await buildSky(scene, renderer);
  const lightInfo = buildLights(scene);

  const ground = buildGround({ anisotropy: maxAniso });
  environmentGroup.add(ground);

  const paths = await buildPaths({ anisotropy: maxAniso });
  environmentGroup.add(paths);

  const river = await buildRiver();
  environmentGroup.add(river);

  const fence = await buildFence({ anisotropy: maxAniso });
  environmentGroup.add(fence);

  const lamps = await buildLampposts();
  environmentGroup.add(lamps);

  const stalls = await buildFoodStalls();
  environmentGroup.add(stalls);

  const coaster = await buildCoaster({ position: [52, 0, 54], camera, renderer, anisotropy: maxAniso });
  environmentGroup.add(coaster);
  window.__lp.coaster = coaster.userData.controller;

  const SOUTH_BIAS = 25;
  const faceYaw = (x) => Math.atan2(-x, SOUTH_BIAS);
  const FRONTAGES = [
    { title: 'TANGLED TWISTER', theme: 'coaster',  groupName: 'coaster',     sign: [15, 0, 44],   panel: [9, 0, 50] },
    { title: 'SKY WHEEL',       theme: 'ferris',    groupName: 'ferrisWheel', sign: [-26, 0, -38], panel: [-18, 0, -32] },
    { title: 'GOLDEN CAROUSEL', theme: 'carousel',  groupName: 'carousel',    sign: [22, 0, -26],  panel: [15, 0, -20] },
    { title: 'TURBO TAGADA',    theme: 'tagada',    groupName: 'tagada',      sign: [-22, 0, 28],  panel: [-15, 0, 34] },
    { title: 'SCENIC RAILWAY',  theme: 'train',     groupName: 'train',       sign: [76, 0, -65],   panel: [68, 0, -60] },
    { title: 'SHOOTING GALLERY', theme: 'gallery',  groupName: 'shootingGallery', sign: [11, 0, 20], panel: null },
  ];
  const signKeepOut = [];
  for (const f of FRONTAGES) {
    const yaw = faceYaw(f.sign[0]);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    signKeepOut.push([f.sign[0], f.sign[2], 10.0]);
    signKeepOut.push([f.sign[0] + fx * 9, f.sign[2] + fz * 9, 8.0]);
    if (f.panel) {
      signKeepOut.push([f.panel[0], f.panel[2], 4.5]);
    }
  }

  const train = await buildTrain({ anisotropy: maxAniso });
  environmentGroup.add(train);
  window.__lp.train = train.userData.controller;

  if (train.userData.footprint) {
    const pad = train.userData.footprint.pad;
    for (let i = 0; i < train.userData.footprint.pts.length; i += 2) {
      signKeepOut.push([train.userData.footprint.pts[i], train.userData.footprint.pts[i+1], pad]);
    }
  }

  const vegetation = await buildVegetation({
    coasterFootprint: coaster.userData.footprint,
    trainFootprint: train.userData.footprint,
    signKeepOut
  });
  environmentGroup.add(vegetation);

  const benches = await buildBenches();
  environmentGroup.add(benches);

  const bridge = paths.getObjectByName('japanese_bridge');
  const visitors = await buildVisitors({
    count: 10,
    obstacles: vegetation.userData.obstacles || [],
    coasterFootprint: coaster.userData.footprint,
    bridge,
  });
  environmentGroup.add(visitors);

  environmentGroup.add(buildEntranceGate());
  const stage = buildStage({ anisotropy: maxAniso });
  environmentGroup.add(stage);

  const fireworks = buildFireworks();
  scene.add(fireworks);

  const balloonContainer = await buildBalloon();
  balloons = balloonContainer.userData.controller.balloons;
  environmentGroup.add(balloonContainer);

  const shootingGallery = await buildShootingGallery({ camera, renderer, controls });
  const sgYaw = faceYaw(11);
  const sgOffset = new THREE.Vector3(0, 0, 1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), sgYaw);
  shootingGallery.position.set(11 + sgOffset.x, 0, 20 + sgOffset.z);
  shootingGallery.rotation.y = sgYaw;
  environmentGroup.add(shootingGallery);
  window.__lp.shootingGallery = shootingGallery.userData.controller;

  const ferrisWheel = await buildFerrisWheel({ position: [-50, 0, -50], camera, renderer });
  environmentGroup.add(ferrisWheel);
  window.__lp.ferrisWheel = ferrisWheel.userData.controller;

  const carousel = await buildCarousel({ position: [40, 0, -40], camera, renderer, anisotropy: maxAniso });
  environmentGroup.add(carousel);
  window.__lp.carousel = carousel.userData.controller;

  const tagada = await buildTagada({ position: [-40, 0, 40], camera, renderer, anisotropy: maxAniso });
  environmentGroup.add(tagada);
  window.__lp.tagada = tagada.userData.controller;

  {
    const fw = environmentGroup.getObjectByName('ferrisWheel');
    if (fw) { fw.userData.rideId = 'ferris'; fw.userData.rideName = 'Sky Wheel'; }
    const cr = environmentGroup.getObjectByName('carousel');
    if (cr) { cr.userData.rideId = 'carousel'; cr.userData.rideName = 'Golden Carousel'; }
    const tg = environmentGroup.getObjectByName('tagada');
    if (tg) { tg.userData.rideId = 'tagada'; tg.userData.rideName = 'Turbo Tagada'; }
    const co = environmentGroup.getObjectByName('coaster');
    if (co) { co.userData.rideId = 'coaster'; co.userData.rideName = 'Tangled Twister'; }
    const tr = environmentGroup.getObjectByName('train');
    if (tr) { tr.userData.rideId = 'train'; tr.userData.rideName = 'Scenic Railway'; }
  }

  rideSigns = FRONTAGES.map(({ title, theme, groupName, sign, panel }) => {
    const group = environmentGroup.getObjectByName(groupName);

    const s = buildRideSign({ title, theme, anisotropy: maxAniso });
    s.position.set(sign[0], sign[1], sign[2]);
    s.rotation.y = faceYaw(sign[0]);
    environmentGroup.add(s);

    const ctrl = group && group.userData.controller;
    if (ctrl && ctrl.panel && panel) {
      const gp = group.position;
      ctrl.panel.position.set(panel[0] - gp.x, -gp.y, panel[2] - gp.z);
      ctrl.panel.rotation.set(0, faceYaw(panel[0]), 0);
    }

    const hintPos = panel ? [panel[0], 10.3, panel[2]] : [sign[0], 10.3, sign[2]];
    const hintLines = groupName === 'shootingGallery'
      ? ['🎯  Click to Play', 'Press ESC to Exit  •  T to aim']
      : ['Click Panel to Turn On/Off', 'Adjust Speed in HUD'];
    const hint = buildRideHint({ position: hintPos, lines: hintLines });
    hint.name = 'rideHint_' + groupName;
    environmentGroup.add(hint);
    rideHints.push(hint);
    return s;
  });
  window.__lp.rideSigns = rideSigns;

  dayNight = new DayNightCycle({
    scene,
    renderer,
    sun: lightInfo.sun,
    hemi: lightInfo.hemi,
    setSkyTime: skyInfo.setTime,
    getLamps: () => lamps.children,
    getWaterMaterial: () => {
      const water = river.getObjectByName('water');
      const surface = water?.getObjectByName('river_surface');
      return surface?.material;
    },
  });

  hud = buildHud(dayNight);
  dayNight.setHour(12);

  const interactionManager = new InteractionManager(camera, renderer, scene, controls);

  lamps.children.forEach(lamp => {
    if (lamp.name.startsWith('lamp_')) {
      interactionManager.registerClickable(lamp);
    }
  });

  interactionManager.registerClickable(ferrisWheel.userData.controller.panel);
  interactionManager.registerClickable(carousel.userData.controller.panel);
  interactionManager.registerClickable(tagada.userData.controller.panel);
  interactionManager.registerClickable(coaster.userData.controller.panel);
  interactionManager.registerClickable(train.userData.controller.panel);

  const sgHint = rideHints.find(h => h.name === 'rideHint_shootingGallery');
  if (sgHint) {
    interactionManager.registerClickable(sgHint);
  }

  interactionManager.registerClickable(stage.userData.spotLight);
  cameraManager.setInteractiveObjects(interactionManager.interactiveObjects);

  buildRideHotbar({
    rides: [
      { id: 'ferris',   name: 'Sky Wheel',        icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="7"/><path d="M12 3v14M5 10h14M7.05 5.05l9.9 9.9M7.05 14.95l9.9-9.9"/><circle cx="12" cy="10" r="1.2" fill="currentColor"/></svg>' },
      { id: 'carousel', name: 'Golden Carousel',  icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L8 6h8l-4-4z"/><rect x="4" y="6" width="16" height="3" rx="1"/><path d="M6 9v2M10 9v2M14 9v2M18 9v2"/><path d="M6 11l-2 7h16l-2-7"/><path d="M4 18h16"/><circle cx="8" cy="14.5" r="0.8" fill="currentColor"/><circle cx="12" cy="14.5" r="0.8" fill="currentColor"/><circle cx="16" cy="14.5" r="0.8" fill="currentColor"/></svg>' },
      { id: 'coaster',  name: 'Tangled Twister',  icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2-4 4-6 6-6s4 4 6 4 4-6 6-6"/><path d="M2 18c2-4 4-6 6-6s4 4 6 4 4-6 6-6"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></svg>' },
      { id: 'tagada',   name: 'Turbo Tagada',      icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>' },
      { id: 'train',    name: 'Scenic Railway',    icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="6" width="14" height="11" rx="2"/><circle cx="9" cy="20" r="1.5" fill="currentColor"/><circle cx="15" cy="20" r="1.5" fill="currentColor"/><path d="M5 12h14"/></svg>' },
      { id: 'balloon',  name: 'Hot Air Balloon',   icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-3.5 0-6 2.5-6 6 0 4 3 8 6 8s6-4 6-8c0-3.5-2.5-6-6-6z"/><path d="M9 17l3 4 3-4"/><path d="M12 7v6"/></svg>' }
    ],
    onSelect: (id, opts) => {
      if (opts && opts.toggle) {
        cameraManager.exitFPV();
      } else {
        cameraManager.enterFPVById(id);
      }
    },
    getActiveRideId: () =>
      cameraManager.isFPV ? cameraManager._fpvRide?.group?.userData?.rideId ?? null : null
  });

  eventBus.on('interact-click', ({ object }) => {
    let curr = object;
    while (curr && !curr.userData.lampId) {
      curr = curr.parent;
    }
    if (curr && curr.userData.lampId) {
      const isNight = isNightNow(curr);
      if (!curr.userData.mode) curr.userData.mode = 'auto';

      if (curr.userData.mode === 'auto') {
        curr.userData.mode = 'on';
        curr.userData.blinkTime = 0;
      } else if (curr.userData.mode === 'on') {
        curr.userData.mode = 'off';
        curr.userData.blinkTime = 0;
      } else {
        curr.userData.mode = 'auto';
        curr.userData.blinkTime = 0.4;
      }
      return;
    }

    curr = object;
    while (curr && curr.name !== 'controlPanel') {
      curr = curr.parent;
    }
    if (curr) {
      if (ferrisWheel.userData.controller.panel === curr) ferrisWheel.userData.controller.toggle();
      if (carousel.userData.controller.panel === curr) carousel.userData.controller.toggle();
      if (tagada.userData.controller.panel === curr) tagada.userData.controller.toggle();
      if (coaster.userData.controller.panel === curr) coaster.userData.controller.toggle();
      if (train.userData.controller.panel === curr) train.userData.controller.toggle();
      return;
    }

    let checkHint = object;
    while (checkHint && checkHint.name !== 'rideHint_shootingGallery') {
      checkHint = checkHint.parent;
    }
    if (checkHint && checkHint.name === 'rideHint_shootingGallery') {
      shootingGallery.userData.controller.enterAimMode();
      return;
    }

    curr = object;
    while (curr && curr.name !== 'stage_spotlight') {
      curr = curr.parent;
    }
    if (curr && curr.name === 'stage_spotlight') {
      const isNight = isNightNow(curr);
      if (!curr.userData.mode) curr.userData.mode = 'auto';

      if (curr.userData.mode === 'auto') {
        curr.userData.mode = 'on';
        curr.userData.blinkTime = 0;
      } else if (curr.userData.mode === 'on') {
        curr.userData.mode = 'off';
        curr.userData.blinkTime = 0;
      } else {
        curr.userData.mode = 'auto';
        curr.userData.blinkTime = 0.4;
      }
    }
  });

  const colorInput = document.getElementById('lightColor');
  if (colorInput) {
    colorInput.addEventListener('input', () => {
      eventBus.emit('color-change', colorInput.value);
    });
  }

  const autoCheckbox = document.getElementById('autoTime');
  if (autoCheckbox) {
    autoCheckbox.addEventListener('change', () => {
      autoAdvance = autoCheckbox.checked;
    });
  }

  document.querySelectorAll('.ride-speed-slider').forEach((slider) => {
    const valSpan = slider.nextElementSibling;
    slider.addEventListener('input', () => {
      const rideName = slider.dataset.ride;
      const val = parseFloat(slider.value);
      if (valSpan) valSpan.textContent = val.toFixed(2);
      let ctrl = null;
      if (rideName === 'ferrisWheel') ctrl = ferrisWheel.userData.controller;
      else if (rideName === 'carousel') ctrl = carousel.userData.controller;
      else if (rideName === 'tagada') ctrl = tagada.userData.controller;
      else if (rideName === 'coaster') ctrl = coaster.userData.controller;
      else if (rideName === 'train') ctrl = train.userData.controller;
      if (ctrl) ctrl.speedMultiplier = val;
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'BUTTON')) {
        return;
      }
      autoAdvance = !autoAdvance;
      if (autoCheckbox) autoCheckbox.checked = autoAdvance;
    }
    if (e.code === 'KeyT') {
      const sg = shootingGallery.userData.controller;
      if (sg && !sg.aimMode) {
        const dist = camera.position.distanceTo(new THREE.Vector3(12, 0, 24));
        if (dist < 50) {
          sg.enterAimMode();
        }
      }
    }
    if (e.code === 'KeyF') {
      eventBus.emit('trigger-fireworks-show');
    }
  });

  const speedBtn = document.getElementById('speedBtn');
  const speedPanel = document.getElementById('speedPanel');
  if (speedBtn && speedPanel) {
    const speedIcon = speedBtn.querySelector('.accordion-icon');
    speedBtn.addEventListener('click', () => {
      const open = speedPanel.style.display !== 'none';
      speedPanel.style.display = open ? 'none' : 'block';
      speedIcon.textContent = open ? '+' : '−';
    });
  }

  const helpToggleBtn = document.getElementById('helpToggleBtn');
  const helpOverlay = document.getElementById('helpOverlay');
  const helpOverlayClose = document.getElementById('helpOverlayClose');
  if (helpToggleBtn && helpOverlay) {
    helpToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      helpOverlay.classList.toggle('open');
    });
    if (helpOverlayClose) {
      helpOverlayClose.addEventListener('click', () => {
        helpOverlay.classList.remove('open');
      });
    }
  }

  Object.assign(world, {
    river, vegetation, visitors, stage, ferrisWheel, carousel, tagada, coaster,
    lamps, stalls, fireworks, balloons, train, shootingGallery, fence,
    gate: environmentGroup.getObjectByName('entranceGate'),
    timeInput: document.getElementById('timeOfDay'),
    timeVal: document.getElementById('timeVal'),
  });

  loaderEl.classList.add("hidden");

  if (colorInput) {
    eventBus.emit('color-change', colorInput.value);
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

function animate() {
  TWEEN.update();
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();
  const wind = hud.getWindSpeed();
  if (!cameraManager || cameraManager.state !== 'flying') {
    controls.update(delta);
  }

  if (autoAdvance && dayNight) {
    const hoursPerSec = 0.05;
    let nextHour = dayNight.t * 24 + hoursPerSec * delta;
    if (nextHour >= 24) nextHour -= 24;
    dayNight.setHour(nextHour);

    if (world.timeInput) world.timeInput.value = nextHour;
    if (world.timeVal) {
      const h = Math.floor(nextHour);
      const m = Math.floor((nextHour - h) * 60);
      world.timeVal.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    hud.drawTimeArc(nextHour);
  }

  if (world.river) world.river.userData.update(delta, time);
  if (world.vegetation?.userData.tick) world.vegetation.userData.tick(delta, time, wind);
  if (world.visitors?.userData.tick) world.visitors.userData.tick(delta, time);
  if (world.gate?.userData.tick) world.gate.userData.tick(delta, time, wind);
  if (world.stalls?.userData.tick) world.stalls.userData.tick(delta, time, wind);
  if (world.stage?.userData.tick) world.stage.userData.tick(delta, time);
  if (world.ferrisWheel?.userData.tick) world.ferrisWheel.userData.tick(delta, time);
  if (world.carousel?.userData.tick) world.carousel.userData.tick(delta, time);
  if (world.tagada?.userData.tick) world.tagada.userData.tick(delta, time);
  if (world.coaster?.userData.tick) world.coaster.userData.tick(delta, time);
  if (world.fireworks?.userData.tick) world.fireworks.userData.tick(delta, time);
  if (world.balloons) {
    for (const b of world.balloons) {
      if (b.userData.tick) b.userData.tick(delta, time, wind);
    }
  }
  if (world.train?.userData.tick) world.train.userData.tick(delta, time);
  if (world.shootingGallery?.userData.tick) world.shootingGallery.userData.tick(delta, time);

  for (const sign of rideSigns) {
    if (sign.userData.tick) sign.userData.tick(delta, time);
  }
  for (const hint of rideHints) {
    hint.userData.tick(delta, time, camera);
  }

  if (cameraManager) cameraManager.tick(delta);
  if (world.lamps?.userData.tick) world.lamps.userData.tick(delta, time);
  if (world.fence?.userData.tick) world.fence.userData.tick(delta, time);

  composer.render();

  fpsFrames++;
  const now = performance.now();
  if (now - fpsLastTime >= 500) {
    const fps = Math.round((fpsFrames * 1000) / (now - fpsLastTime));
    if (fpsEl) fpsEl.textContent = `FPS: ${fps}`;
    fpsFrames = 0;
    fpsLastTime = now;
  }

  requestAnimationFrame(animate);
}

init()
  .then(() => animate())
  .catch((err) => {
    console.error('Init failed:', err);
    loaderEl.textContent = 'Failed to load scene — see console.';
  });

window.__lp = { THREE, scene, camera, renderer, controls, cameraManager };
