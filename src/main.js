import * as THREE from 'three';
import { Movement } from './movement.js';

// ---------- DOM ----------
const canvas = document.getElementById('canvas');
const menu = document.getElementById('menu');
const statusEl = document.getElementById('status');
const speedEl = document.getElementById('speed');
const infoEl = document.getElementById('info');
const roomInput = document.getElementById('room-input');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0c14);
scene.fog = new THREE.FogExp2(0x0b0c14, 0.008);

const camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.1, 2000);
camera.rotation.order = 'YXZ';

// ---------- Lighting ----------
const hemi = new THREE.HemisphereLight(0x9bb8ff, 0x1a1520, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff0d8, 1.4);
sun.position.set(40, 80, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x4a6cff, 0.25);
fill.position.set(-30, 20, -40);
scene.add(fill);

// ---------- World (simple arena) ----------
const worldGroup = new THREE.Group();
scene.add(worldGroup);

const groundMat = new THREE.MeshStandardMaterial({
  color: 0x1e2230,
  roughness: 0.85,
  metalness: 0.05
});
const accentMat = new THREE.MeshStandardMaterial({
  color: 0x2a3145,
  roughness: 0.7,
  metalness: 0.1
});
const rampMat = new THREE.MeshStandardMaterial({
  color: 0x3a4a6a,
  roughness: 0.6,
  metalness: 0.15
});
const neonMat = new THREE.MeshStandardMaterial({
  color: 0x7dffb3,
  emissive: 0x7dffb3,
  emissiveIntensity: 0.6,
  roughness: 0.3
});

// floor
const floor = new THREE.Mesh(new THREE.BoxGeometry(200, 2, 200), groundMat);
floor.position.y = -1;
floor.receiveShadow = true;
worldGroup.add(floor);

// walls
function wall(w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), accentMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  worldGroup.add(m);
  return m;
}
wall(200, 12, 2, 0, 5, -100);
wall(200, 12, 2, 0, 5, 100);
wall(2, 12, 200, -100, 5, 0);
wall(2, 12, 200, 100, 5, 0);

// platforms + ramps for movement
function box(w, h, d, x, y, z, mat = accentMat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  worldGroup.add(m);
  return m;
}

box(30, 4, 30, 0, 2, -40);           // center platform
box(16, 8, 16, 45, 4, 30);
box(16, 12, 16, -50, 6, 20);
box(40, 2, 12, 0, 1, 50);             // long low platform

// ramps (simple rotated boxes)
function ramp(w, h, d, x, y, z, rotZ = 0, rotX = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rampMat);
  m.position.set(x, y, z);
  m.rotation.z = rotZ;
  m.rotation.x = rotX;
  m.castShadow = true;
  m.receiveShadow = true;
  worldGroup.add(m);
  return m;
}
ramp(20, 1.5, 14, 25, 3, -40, 0, -0.35);
ramp(20, 1.5, 14, -25, 3, -40, 0, 0.35);
ramp(12, 1.2, 18, 45, 5, 10, 0, -0.4);

// neon strips
function neon(w, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), neonMat);
  m.position.set(x, y, z);
  worldGroup.add(m);
}
neon(40, 0.4, 0, 0.05, -55);
neon(0.4, 40, 55, 0.05, 0);
neon(0.4, 40, -55, 0.05, 0);

// simple collision AABBs (very basic)
const colliders = [
  { min: { x: -100, y: -2, z: -100 }, max: { x: 100, y: 0, z: 100 } }, // floor
  // platforms
  { min: { x: -15, y: 0, z: -55 }, max: { x: 15, y: 4, z: -25 } },
  { min: { x: 37, y: 0, z: 22 }, max: { x: 53, y: 8, z: 38 } },
  { min: { x: -58, y: 0, z: 12 }, max: { x: -42, y: 12, z: 28 } },
  { min: { x: -20, y: 0, z: 44 }, max: { x: 20, y: 2, z: 56 } },
];

// ---------- Player ----------
const player = new Movement({
  autoBhop: true,
  bhopSpeedClamp: false,
  airAccelerate: 35,       // a bit more forgiving than pure CS:GO
  airMaxWishSpeed: 30,
});
player.pos.set = undefined; // just in case
player.pos.x = 0;
player.pos.y = 64;
player.pos.z = 20;

// remote players
const remotes = new Map(); // id -> { mesh, targetPos, targetAng }

function makePlayerMesh(color = 0x5b8def) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(12, 28, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
  );
  body.position.y = 28;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(10, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffe0c0, roughness: 0.5 })
  );
  head.position.y = 52;
  g.add(head);
  return g;
}

const localMesh = makePlayerMesh(0x7dffb3);
localMesh.visible = false; // first person
scene.add(localMesh);

// ---------- Input ----------
const keys = {};
let pointerLocked = false;
let mouseDX = 0, mouseDY = 0;

const SENS = 0.08;

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  mouseDX += e.movementX;
  mouseDY += e.movementY;
});

canvas.addEventListener('click', () => {
  if (!pointerLocked) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (pointerLocked) {
    menu.classList.add('hidden');
    statusEl.textContent = 'Playing';
  } else {
    statusEl.textContent = 'Click to resume';
  }
});

// ---------- Multiplayer (PeerJS) ----------
let peer = null;
let connections = new Map();
let myId = null;
let roomCode = null;
let isHost = false;

function startMultiplayer(code) {
  roomCode = (code || Math.random().toString(36).slice(2, 6)).toUpperCase();
  roomInput.value = roomCode;

  // dynamic import so solo still works offline
  import('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js').then(() => {
    // PeerJS attaches to window
    peer = new window.Peer(roomCode + '-' + Math.random().toString(36).slice(2, 6), {
      debug: 1
    });

    peer.on('open', id => {
      myId = id;
      statusEl.textContent = `Room ${roomCode} · id ${id.slice(-4)}`;
      // try to connect to host (roomCode itself) or become host
      const hostId = roomCode;
      if (id.startsWith(roomCode)) {
        // we are a random id, try connect to host
        const conn = peer.connect(hostId, { reliable: true });
        setupConn(conn);
      }
    });

    peer.on('connection', conn => {
      isHost = true;
      setupConn(conn);
    });

    peer.on('error', err => {
      console.warn('Peer error', err);
      // if host id taken, just keep our random id and wait for others
      statusEl.textContent = `Room ${roomCode} (open)`;
    });
  }).catch(err => {
    console.warn('PeerJS failed to load, solo only', err);
    statusEl.textContent = 'Solo (multiplayer unavailable)';
  });
}

function setupConn(conn) {
  connections.set(conn.peer, conn);
  conn.on('open', () => {
    statusEl.textContent = `Connected · ${connections.size} peer(s)`;
  });
  conn.on('data', data => {
    if (data.t === 'state') {
      let r = remotes.get(conn.peer);
      if (!r) {
        r = { mesh: makePlayerMesh(), targetPos: new THREE.Vector3(), targetAng: 0 };
        scene.add(r.mesh);
        remotes.set(conn.peer, r);
      }
      r.targetPos.set(data.x, data.y, data.z);
      r.targetAng = data.yaw;
    }
  });
  conn.on('close', () => {
    connections.delete(conn.peer);
    const r = remotes.get(conn.peer);
    if (r) {
      scene.remove(r.mesh);
      remotes.delete(conn.peer);
    }
  });
}

function broadcastState() {
  if (!connections.size) return;
  const payload = {
    t: 'state',
    x: player.pos.x,
    y: player.pos.y - 64, // feet-ish
    z: player.pos.z,
    yaw: player.angles.yaw
  };
  for (const conn of connections.values()) {
    if (conn.open) conn.send(payload);
  }
}

// ---------- Collision (very simple AABB) ----------
function resolveCollisions() {
  const r = 14;          // player radius
  const h = player.ducking ? 36 : 64;
  const feetY = player.pos.y - 64;
  let grounded = false;

  // floor
  if (feetY <= 0) {
    player.pos.y = 64;
    if (player.vel.y < 0) player.vel.y = 0;
    grounded = true;
  }

  // simple platform checks
  for (const c of colliders) {
    if (c === colliders[0]) continue; // skip floor, already handled
    const px = player.pos.x;
    const pz = player.pos.z;
    const py = feetY;

    if (px + r > c.min.x && px - r < c.max.x &&
        pz + r > c.min.z && pz - r < c.max.z) {
      // above?
      if (py >= c.max.y - 8 && py <= c.max.y + 12 && player.vel.y <= 0) {
        player.pos.y = c.max.y + 64;
        player.vel.y = 0;
        grounded = true;
      }
    }
  }

  // soft wall clamp
  player.pos.x = Math.max(-95, Math.min(95, player.pos.x));
  player.pos.z = Math.max(-95, Math.min(95, player.pos.z));

  player.setGrounded(grounded);
}

// ---------- Main loop ----------
let last = performance.now();
let sendAcc = 0;

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;

  // mouse look
  if (pointerLocked) {
    player.angles.yaw -= mouseDX * SENS;
    player.angles.pitch -= mouseDY * SENS;
    player.angles.pitch = Math.max(-89, Math.min(89, player.angles.pitch));
    mouseDX = 0;
    mouseDY = 0;
  }

  // keys → movement
  player.forward = (keys['KeyW'] ? 1 : 0) + (keys['KeyS'] ? -1 : 0);
  player.side    = (keys['KeyD'] ? 1 : 0) + (keys['KeyA'] ? -1 : 0);
  player.jump    = !!keys['Space'];
  player.duck    = !!(keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC']);
  player.walk    = !!(keys['ShiftLeft'] || keys['ShiftRight']);

  // edge detect jump
  if (player.jump && !player._wasJump) player.jumpPressed = true;
  player._wasJump = player.jump;

  if (pointerLocked) {
    player.update(dt);
    resolveCollisions();
  }

  // camera
  const eye = player.eyePosition;
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.y = player.angles.yaw * Math.PI / 180;
  camera.rotation.x = player.angles.pitch * Math.PI / 180;

  // local mesh (for shadows / 3rd if needed)
  localMesh.position.set(player.pos.x, player.pos.y - 64, player.pos.z);
  localMesh.rotation.y = player.angles.yaw * Math.PI / 180;

  // interpolate remotes
  for (const r of remotes.values()) {
    r.mesh.position.lerp(r.targetPos, 1 - Math.pow(0.001, dt));
    r.mesh.rotation.y = r.targetAng * Math.PI / 180;
  }

  // network
  sendAcc += dt;
  if (sendAcc > 0.05) {
    sendAcc = 0;
    broadcastState();
  }

  // HUD
  const spd = Math.round(player.horizontalSpeed);
  speedEl.textContent = spd;
  speedEl.className = 'speed' + (spd > 400 ? ' insane' : spd > 300 ? ' veryfast' : spd > 250 ? ' fast' : '');
  infoEl.textContent = player.sliding ? 'SLIDE' : player.onGround ? 'ground' : 'air';

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- UI buttons ----------
document.getElementById('btn-solo').addEventListener('click', () => {
  menu.classList.add('hidden');
  canvas.requestPointerLock();
  statusEl.textContent = 'Solo';
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = roomInput.value.trim() || null;
  startMultiplayer(code);
  menu.classList.add('hidden');
  canvas.requestPointerLock();
});

// resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
