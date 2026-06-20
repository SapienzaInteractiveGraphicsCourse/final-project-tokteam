import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { Easings } from '../utils/Easings.js';

class ControlPanel {
  constructor({ initialRunning = true, onToggle, rampUp = 0.5, rampDown = 0.5 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'controlPanel';

    this.running = initialRunning;
    this.ease = initialRunning ? 1.0 : 0.0;
    this.speedMultiplier = 1.0;
    this.onToggle = onToggle;
    this.eStopPressTime = 0.0;
    this._rampTween = null;

    this.RAMP_UP = rampUp;
    this.RAMP_DOWN = rampDown;

    this.LEVER_REST = 2.62;  // pointing down-forward (~ -60 deg from horizontal) when off
    this.LEVER_ON = 0.52;   // pointing up-forward (~ 60 deg from horizontal) when on

    this.build();
    this.setState(this.ease);
  }

  build() {
    // Scale up the entire control panel group to make it bigger (3.5x size)
    this.group.scale.setScalar(3.5);

    // Premium materials
    const metalBody = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.2, metalness: 0.8 });
    const darkConsoleMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.5, metalness: 0.2 });
    const accentBrass = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.15, metalness: 0.9 }); // gold/brass trim
    const screenMat = new THREE.MeshBasicMaterial({ map: this.createScreenTexture() });
    const emergencyButtonMat = new THREE.MeshStandardMaterial({ color: 0xd30000, roughness: 0.5 });
    const emergencyBaseMat = new THREE.MeshStandardMaterial({ color: 0xffd300, roughness: 0.4 }); // yellow guard
    const greenButtonMat = new THREE.MeshStandardMaterial({ color: 0x00aa22, roughness: 0.5 });
    const blackButtonMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });

    // 1. Base Plate / Pedestal (Flange)
    const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.08, 16), metalBody);
    basePlate.position.y = 0.04;
    basePlate.castShadow = true;
    basePlate.receiveShadow = true;
    this.group.add(basePlate);

    // Bolt details on base plate
    const boltGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 6);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(boltGeo, accentBrass);
      bolt.position.set(Math.cos(angle) * 0.35, 0.09, Math.sin(angle) * 0.35);
      this.group.add(bolt);
    }

    // 2. Post with detailed collars
    const postHeight = 1.1;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, postHeight, 16), metalBody);
    post.position.y = postHeight / 2 + 0.08;
    post.castShadow = true;
    post.receiveShadow = true;
    this.group.add(post);

    // Post collars (rings)
    const collarGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16);
    const bottomCollar = new THREE.Mesh(collarGeo, accentBrass);
    bottomCollar.position.y = 0.18;
    this.group.add(bottomCollar);

    const topCollar = new THREE.Mesh(collarGeo, accentBrass);
    topCollar.position.y = postHeight + 0.02;
    this.group.add(topCollar);

    const flangeCollar = new THREE.Mesh(collarGeo, accentBrass);
    flangeCollar.position.y = 1.16;
    this.group.add(flangeCollar);

    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.04, 16), metalBody);
    flange.position.y = 1.22;
    this.group.add(flange);

    // 4. Sloped Console Group
    const consoleGroup = new THREE.Group();
    consoleGroup.position.set(0.0, 1.54, 0.0);
    consoleGroup.rotation.x = 0; // vertical panel face
    this.group.add(consoleGroup);

    // Console Housing
    const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.18), darkConsoleMat);
    consoleBox.castShadow = true;
    consoleBox.receiveShadow = true;
    consoleGroup.add(consoleBox);

    // Bezel (metallic border on console face)
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.62, 0.03), metalBody);
    bezel.position.z = -0.08;
    consoleGroup.add(bezel);

    // LCD Screen (cyan glow) - ENLARGED
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.44, 0.02), screenMat);
    screen.position.set(-0.16, 0.0, 0.091);
    consoleGroup.add(screen);

    // Screen frame - ENLARGED
    const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.48, 0.01), metalBody);
    screenFrame.position.set(-0.16, 0.0, 0.085);
    consoleGroup.add(screenFrame);

    const leverMountDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.02, 16), metalBody);
    leverMountDisc.rotation.x = Math.PI / 2;
    leverMountDisc.position.set(0.35, 0.05, 0.095);
    consoleGroup.add(leverMountDisc);

    // 5. Semaphore Tower housing (arched top)
    const semTower = new THREE.Group();
    semTower.position.set(0.0, 2.14, -0.05);
    this.group.add(semTower);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.68, 0.22), darkConsoleMat);
    housing.castShadow = true;
    housing.receiveShadow = true;
    semTower.add(housing);

    const housingBezel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.7, 0.03), metalBody);
    housingBezel.position.z = -0.1;
    semTower.add(housingBezel);

    // Warning Beacon on top of semaphore housing
    const beaconBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 12), metalBody);
    beaconBase.position.y = 0.36;
    semTower.add(beaconBase);

    this.beaconMat = new THREE.MeshStandardMaterial({
      color: 0xffa500,
      emissive: 0xffa500,
      emissiveIntensity: 0.0,
      roughness: 0.2
    });
    const beaconDome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.beaconMat);
    beaconDome.position.y = 0.38;
    semTower.add(beaconDome);

    // Lamps & Hoods/Visors
    this._redOff   = new THREE.Color(0x2a0000);
    this._redOn    = new THREE.Color(0xff1100);
    this._greenOff = new THREE.Color(0x002a00);
    this._greenOn  = new THREE.Color(0x00ee33);
    this.redMat   = new THREE.MeshBasicMaterial({ color: this._redOff.clone() });
    this.greenMat = new THREE.MeshBasicMaterial({ color: this._greenOff.clone() });
    const lampGeo = new THREE.SphereGeometry(0.11, 14, 12);
    
    this.redLamp = new THREE.Mesh(lampGeo, this.redMat);
    this.redLamp.position.set(0, 0.16, 0.08);
    semTower.add(this.redLamp);

    this.greenLamp = new THREE.Mesh(lampGeo, this.greenMat);
    this.greenLamp.position.set(0, -0.16, 0.08);
    semTower.add(this.greenLamp);

    // Hoods/Visors (curved traffic-light shields)
    const visorGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.16, 12, 1, true, -Math.PI / 2, Math.PI); // Half cylinder
    
    const redVisor = new THREE.Mesh(visorGeo, metalBody);
    redVisor.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    redVisor.position.set(0, 0.16, 0.12);
    semTower.add(redVisor);

    const greenVisor = new THREE.Mesh(visorGeo, metalBody);
    greenVisor.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    greenVisor.position.set(0, -0.16, 0.12);
    semTower.add(greenVisor);

    // 6. Mechanical Lever - flush to panel face
    this.lever = new THREE.Group();
    this.lever.position.set(0.35, 1.59, 0.18);
    this.group.add(this.lever);

    // Lever Hinge Mount
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), metalBody);
    hinge.rotation.z = Math.PI / 2;
    this.lever.add(hinge);

    const hingeCovers = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.11, 10), accentBrass);
    hingeCovers.rotation.z = Math.PI / 2;
    this.lever.add(hingeCovers);

    // Lever Stick (bicolored)
    const lowerStick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 8), metalBody);
    lowerStick.position.y = 0.10;
    lowerStick.castShadow = true;
    this.lever.add(lowerStick);

    const upperStick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.18, 8), accentBrass);
    upperStick.position.y = 0.30;
    upperStick.castShadow = true;
    this.lever.add(upperStick);

    // Knob
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4 }));
    knob.position.y = 0.40;
    this.lever.add(knob);
  }

  setState(ease) {
    this.redMat.color.lerpColors(this._redOff, this._redOn, 1.0 - ease);
    this.greenMat.color.lerpColors(this._greenOff, this._greenOn, ease);
    this.lever.rotation.x = THREE.MathUtils.lerp(this.LEVER_REST, this.LEVER_ON, ease);

    // Update canvas screen texture
    this.updateScreen(ease);

    // Blinking yellow beacon when running, fading off when stopped
    if (this.running) {
      this.beaconMat.emissiveIntensity = 0.75 + Math.sin(Date.now() * 0.01) * 0.45;
    } else {
      this.beaconMat.emissiveIntensity = THREE.MathUtils.lerp(this.beaconMat.emissiveIntensity, 0.0, 0.1);
    }



    // Animate emergency button press
    if (this.eStopButton) {
      const btnDepth = this.eStopPressTime > 0 
        ? (0.13 - 0.05 * Math.sin((this.eStopPressTime / 0.3) * Math.PI)) 
        : 0.13;
      this.eStopButton.position.z = btnDepth;
    }
  }

  toggle() {
    this.running = !this.running;
    this.eStopPressTime = 0.3; // trigger 0.3s button press animation

    if (this._rampTween) {
      this._rampTween.stop();
      this._rampTween = null;
    }

    const target = this.running ? 1.0 : 0.0;
    const duration = (this.running ? this.RAMP_UP : this.RAMP_DOWN) * 1000;
    this._rampTween = new TWEEN.Tween(this)
      .to({ ease: target }, duration)
      .easing(Easings.RAMP)
      .start();

    if (this.onToggle) this.onToggle(this.running);
  }

  tick(delta, currentSpeed = 1.0) {
    this.speedMultiplier = currentSpeed;

    // Decrement eStop button animation timer
    if (this.eStopPressTime > 0) {
      this.eStopPressTime = Math.max(0, this.eStopPressTime - delta);
    }

    this.setState(this.ease);
    return this.ease;
  }

  createScreenTexture() {
    const W = 256, H = 192;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    
    this.screenCanvas = canvas;
    this.screenCtx = ctx;

    this.screenTexture = new THREE.CanvasTexture(canvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    return this.screenTexture;
  }

  updateScreen(ease) {
    if (!this.screenCtx) return;
    const ctx = this.screenCtx;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;

    // Clear background
    ctx.fillStyle = '#06131c';
    ctx.fillRect(0, 0, W, H);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(0, 204, 255, 0.12)';
    ctx.lineWidth = 2;
    const gridSize = 16;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Title / Status Label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#80e5ff';
    ctx.fillText('SYSTEM STATUS', W / 2, 30);

    // Draw status bar
    const isRunning = this.running;
    const statusText = isRunning ? 'RUNNING' : 'STANDBY';
    const statusColor = isRunning ? '#00ff66' : '#ff3333';
    
    ctx.font = 'bold 30px monospace';
    ctx.fillStyle = statusColor;
    ctx.fillText(statusText, W / 2, 75);

    // Draw animated graphic
    ctx.strokeStyle = statusColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const waveY = 125;
    if (isRunning) {
      // Dynamic sine wave
      const time = Date.now() * 0.006;
      ctx.moveTo(15, waveY);
      for (let x = 15; x < W - 15; x++) {
        const y = waveY + Math.sin(x * 0.06 - time) * 16 * ease * this.speedMultiplier;
        ctx.lineTo(x, y);
      }
    } else {
      // Flat line
      ctx.moveTo(15, waveY);
      ctx.lineTo(W - 15, waveY);
    }
    ctx.stroke();

    // Speed percentage text at bottom
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#80e5ff';
    const speedPct = Math.round(this.speedMultiplier * 100);
    ctx.fillText(`DRIVE SPEED: ${speedPct}%`, W / 2, 165);

    this.screenTexture.needsUpdate = true;
  }
}

export function buildControlPanel(config) {
  return new ControlPanel(config);
}
