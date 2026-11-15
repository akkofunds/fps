import './ui/styles.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { loadIdentity, saveIdentity, loadSettings, saveSettings, randomTag } from './core/storage.js';
import { PeerManager } from './network/peerManager.js';
import { SessionController } from './game/session.js';
import { Match } from './game/match.js';
import { GameMap, QUALITY } from './world/map.js';
import { loadMageModel } from './character/characterModel.js';
import { PYRO } from './game/pyro.js';
import { LobbyScene } from './ui/lobbyScene.js';
import { Lobby, promptNameDialog } from './ui/lobby.js';
import { Hud } from './ui/hud.js';
import { Chat } from './ui/chat.js';
import { $, show, toast } from './ui/dom.js';

// App shell: one renderer + bloom composer shared by the lobby showcase and matches, one
// Sunvale map instance (static) reused by both, and the lobby ⇄ match state machine.
const KEY_HIST = 'magebreak.history';

// first run: pick a graphics preset from the GPU string
function detectQuality() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|mali|adreno|powervr|apple gpu/i.test(r) || /Android|iPhone|iPad|CrOS/i.test(navigator.userAgent)) return 'low';
    if (/intel|iris|uhd|hd graphics/i.test(r)) return 'medium';
    return 'high';
  } catch { return 'medium'; }
}

class App {
  constructor() {
    this.canvas = $('game');
    this.settings = loadSettings();
    if (!QUALITY[this.settings.quality]) this.settings.quality = detectQuality();
    const Q = QUALITY[this.settings.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = Q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.width = 1; this.height = 1; this.aspect = 1;
    this.input = new Input(this.canvas);
    this.chat = new Chat(this.input);
    this.hud = new Hud(this);
    this.match = null;
    this.paused = false;
    this.lobbyScene = new LobbyScene(this);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const unlock = () => { Audio.init(); Audio.setVolume(this.settings.volume); Audio.resume(); };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this._bindMatchUi();
    this.lastT = performance.now() / 1000;
    this._loop = (t) => this.loop(t);
    this.boot();
  }

  progress(p, text) { $('loadFill').style.width = `${Math.round(p * 100)}%`; if (text) $('loadText').textContent = text; }

  async boot() {
    this.progress(0.1, 'Growing the meadow…');
    await new Promise((r) => setTimeout(r, 30));
    this.map = new GameMap(this.settings.quality);
    this._setupComposer();
    this.progress(0.55, 'Summoning Pyro…');
    try { await loadMageModel(PYRO.model); } catch (e) { console.error(e); toast('Failed to load the character model.'); }
    await this.lobbyScene.init(this.map);
    this.progress(0.85, 'Lighting the braziers…');
    // warm up shaders so the first frames don't hitch
    this.renderer.compile(this.map.scene, this.lobbyScene.camera);
    this.progress(1, '');
    show('loading', false);
    requestAnimationFrame(this._loop);
    let id = loadIdentity();
    if (!id) id = await promptNameDialog();
    this.pm = new PeerManager(id);
    this.pm.on('idTaken', () => {
      const nid = { name: this.pm.identity.name, tag: randomTag() };
      saveIdentity(nid); this.pm.identity = nid;
      toast(`Tag already in use — you are now ${nid.name}#${nid.tag}`);
      this.pm.start();
      this.lobby.renderSocial(); this.lobby.renderParty();
    });
    this.session = new SessionController(this);
    this.session.on('start', (opts) => this.startMatch(opts));
    this.lobby = new Lobby(this);
    this.chat.setContext('lobby', (text) => this.pm.chat(text));
    this.lobby.show(true);
    this.pm.start();
    this.chat.system(`Welcome, ${id.name}#${id.tag}. Share your tag so friends can invite you.`);
  }

  _setupComposer() {
    const Q = QUALITY[this.settings.quality];
    this.composer = null;
    if (!Q.bloom) return;
    const r = this.renderer;
    const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples: this.settings.quality === 'high' ? 4 : 0 });
    this.composer = new EffectComposer(r, target);
    this.renderPass = new RenderPass(this.map.scene, this.lobbyScene.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width / 2, this.height / 2), 0.6, 0.45, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(this.width, this.height);
  }

  renderScene(scene, camera) {
    if (this.composer) { this.renderPass.scene = scene; this.renderPass.camera = camera; this.composer.render(); }
    else this.renderer.render(scene, camera);
  }

  async promptName(force) {
    if (this.match) return;
    this.session.cancel();
    const id = await promptNameDialog(force ? this.pm.identity.name : '');
    this.pm.leaveParty(true);
    this.pm.identity = id;
    this.pm.start();
    this.lobby.renderSocial(); this.lobby.renderParty();
    toast(`You are now ${id.name}#${id.tag}`);
  }

  saveSettings() { saveSettings(this.settings); }
  applySettings() {
    Audio.setVolume(this.settings.volume);
    if (this.match) { this.match.cam.baseFov = this.settings.fov; this.match.cam.side = this.settings.shoulder; }
  }

  history() { try { const h = JSON.parse(localStorage.getItem(KEY_HIST) || '[]'); return Array.isArray(h) ? h : []; } catch { return []; } }
  recordMatch(x) { const h = this.history(); h.unshift(x); try { localStorage.setItem(KEY_HIST, JSON.stringify(h.slice(0, 30))); } catch { /* ignore */ } }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w; this.height = h; this.aspect = w / h;
    const q = this.settings.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.5 : 1));
    this.renderer.setSize(w, h, true);
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); this.bloom.resolution.set(w / 2, h / 2); }
    this.lobbyScene.resize(w, h, w > 860 ? (w > 1100 ? 300 : 240) : 0);
    if (this.match) this.match.resize(w, h);
  }

  _bindMatchUi() {
    const input = this.input;
    input.on('lock', (locked) => {
      if (!this.match) return;
      if (locked) { if (this.paused) this.pause(false); return; }
      if (!this.chat.isOpen && !this.match.ended) this.pause(true);
    });
    input.on('escape', () => { if (this.match && !input.locked) this.pause(!this.paused); });
    $('btnResume').onclick = () => { this.pause(false); input.requestLock(); };
    $('btnLeave').onclick = () => this.leaveMatch();
    $('btnPauseSettings').onclick = () => this.lobby.openSettings();
    $('pause').addEventListener('click', (e) => { if (e.target.id === 'pause') { this.pause(false); input.requestLock(); } });
  }

  pause(on) {
    this.paused = on;
    show('pause', on);
    this.input.enabled = !!this.match && !on;
    $('pauseHint').textContent = 'Click Resume to lock the mouse. Esc releases it.';
    if (on) this.input.exitLock();
  }

  async startMatch(opts) {
    if (this.match) { this.match.dispose(); this.match = null; }
    this.lobby.closeModals();
    show('loading', true); this.progress(0.6, 'Entering Sunvale…');
    let m;
    try {
      m = await Match.create(this, opts);
    } catch (err) {
      console.error(err);
      show('loading', false);
      this.session.endMatch();
      toast('Failed to start the match.');
      return;
    }
    show('loading', false);
    this.lobby.show(false);
    this.lobbyScene.setActive(false);
    this.chat.clear();
    this.chat.setContext('match', (text) => m.sendChat(text));
    this.match = m;
    m.resize(this.width, this.height);
    this.input.enabled = true;
    Audio.init(); Audio.resume();
    this.pause(true);
    $('pauseHint').textContent = 'Match ready — click RESUME (or anywhere) to lock the mouse.';
    $('btnResume').textContent = 'PLAY';
    this.input.requestLock();
  }

  leaveMatch(reason) {
    if (!this.match) return;
    const m = this.match;
    this.match = null;
    m.dispose();
    this.session.endMatch();
    this.input.enabled = false; this.input.exitLock();
    this.paused = false; show('pause', false);
    this.hud.exitMatch();
    this.chat.clear();
    this.chat.setContext('lobby', (text) => this.pm.chat(text));
    this.lobbyScene.setActive(true);
    this.lobby.show(true);
    this.lobby.setTab('play');
    $('btnResume').textContent = 'RESUME';
    if (reason) toast(reason, 3500);
  }

  loop(tMs) {
    requestAnimationFrame(this._loop);
    const t = tMs / 1000;
    const dt = Math.min(0.05, Math.max(0.001, t - this.lastT));
    this.lastT = t;
    if (this.match) {
      this.match.update(dt);
      if (this.match) this.match.render();
    } else {
      this.lobbyScene.update(dt);
      this.renderScene(this.map.scene, this.lobbyScene.camera);
      if (this.lobby) this.lobby.frame();
    }
  }
}

window.__app = new App();
