import './ui/styles.css';
import * as THREE from 'three';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { loadIdentity, saveIdentity, loadSettings, saveSettings, randomTag } from './core/storage.js';
import { PeerManager } from './network/peerManager.js';
import { SessionController } from './game/session.js';
import { Match } from './game/match.js';
import { Viewmodels } from './weapons/viewmodels.js';
import { LobbyScene } from './ui/lobbyScene.js';
import { Lobby, promptNameDialog } from './ui/lobby.js';
import { Hud } from './ui/hud.js';
import { Chat } from './ui/chat.js';
import { TouchControls } from './ui/touchControls.js';
import { $, show, toast } from './ui/dom.js';

// App shell: one WebGL renderer shared by the lobby showcase and matches, a frame-capped
// 60 FPS loop, and the lobby ⇄ match state machine.
class App {
  constructor() {
    this.canvas = $('game');
    this.settings = loadSettings();
    // --- renderer tuned for low-end Chromebooks / phones ---
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, alpha: false, stencil: false, depth: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false; // counted across world + viewmodel passes
    this.width = 1; this.height = 1; this.aspect = 1;
    this.frameDt = 1 / 60;

    this.input = new Input(this.canvas);
    this.viewmodels = new Viewmodels();
    this.lobbyScene = new LobbyScene();
    this.chat = new Chat(this.input);
    this.hud = new Hud(this);
    this.touch = new TouchControls(this);
    this.match = null;
    this.paused = false;

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.resize();

    const unlockAudio = () => { Audio.init(); Audio.setVolume(this.settings.volume); Audio.resume(); };
    window.addEventListener('pointerdown', unlockAudio, { capture: true });
    window.addEventListener('keydown', unlockAudio, { capture: true });
    window.addEventListener('touchend', unlockAudio, { capture: true });

    this._bindMatchUi();
    this._applyMode(this.input.mode);
    this.input.on('mode', (m) => this._applyMode(m));

    this.lastT = performance.now() / 1000;
    this.frameAcc = 0;
    this._loop = (t) => this.loop(t);
    requestAnimationFrame(this._loop);

    // keep a host simulating while its tab is in the background (rAF stops when hidden)
    document.addEventListener('visibilitychange', () => {
      clearInterval(this._bg);
      if (document.hidden && this.match && this.match.isHost) {
        let last = performance.now() / 1000;
        this._bg = setInterval(() => { const n = performance.now() / 1000; if (this.match) this.match.update(Math.min(0.1, n - last)); last = n; }, 50);
      }
    });
    this.init();
  }

  async init() {
    let id = loadIdentity();
    if (!id) id = await promptNameDialog();
    this.pm = new PeerManager(id);
    this.pm.on('idTaken', () => {
      const nid = { name: this.pm.identity.name, tag: randomTag() };
      saveIdentity(nid); this.pm.identity = nid;
      toast(`Tag already in use — you are now ${nid.name}#${nid.tag}`);
      this.pm.start();
      this.lobby.renderParty();
    });
    this.session = new SessionController(this);
    this.session.on('start', (opts) => this.startMatch(opts));
    this.lobby = new Lobby(this);
    this.chat.setContext('lobby', (text) => this.pm.chat(text));
    this.lobby.show(true);
    this.pm.start();
    this.chat.system(`Welcome ${id.name}#${id.tag}. Share your tag so friends can invite you.`);
  }

  async promptName(force) {
    if (this.match) return;
    this.session.cancel();
    const id = await promptNameDialog(force ? this.pm.identity.name : '');
    this.pm.leaveParty(true);
    this.pm.identity = id;
    this.pm.start();
    this.lobby.renderParty();
    toast(`You are now ${id.name}#${id.tag}`);
  }

  saveSettings() { saveSettings(this.settings); }
  applySettings() {
    Audio.setVolume(this.settings.volume);
    this.resize();
    $('crosshair').style.setProperty('--xh', this.settings.crosshairColor);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.width = w; this.height = h; this.aspect = w / h;
    // Clamp DPR to 1.0 — high-DPI Chromebook/phone screens would otherwise render 2-4x the pixels.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0) * (this.settings.renderScale || 1));
    this.renderer.setSize(w, h, false);
    this.viewmodels.setAspect(w / h);
    const panel = w > 860 ? 340 : 0;
    this.lobbyScene.resize(w, h, panel);
  }

  _applyMode(m) {
    document.body.classList.toggle('touch', m === 'touch');
    this.touch.setActive(!!this.match && m === 'touch' && !this.paused);
    if (m === 'touch' && this.paused && this.match) this.pause(false);
  }

  _bindMatchUi() {
    const input = this.input;
    input.on('lock', (locked) => {
      if (!this.match) return;
      if (locked) { if (this.paused) this.pause(false); return; }
      if (input.mode === 'kbm' && !this.match.buyOpen && !this.chat.isOpen && !this.match.ended) this.pause(true);
    });
    input.on('escape', () => { if (!this.match) return; if (this.match.buyOpen) { this.match.closeBuy(); return; } if (input.mode === 'touch') this.pause(!this.paused); });
    input.on('buy', () => { if (this.match && !this.paused) this.match.toggleBuy(); });
    $('btnResume').onclick = () => { this.pause(false); input.requestLock(); };
    $('btnLeave').onclick = () => this.leaveMatch();
    $('btnPauseSettings').onclick = () => this.lobby.openSettings();
    $('pause').addEventListener('click', (e) => { if (e.target.id === 'pause') { this.pause(false); input.requestLock(); } });
  }

  pause(on) {
    this.paused = on;
    show('pause', on);
    this.input.enabled = !!this.match && !on;
    $('pauseHint').textContent = this.input.mode === 'touch' ? 'Tap Resume to continue.' : 'Click Resume to lock the mouse. Esc to release.';
    this.touch.setActive(!!this.match && !on && this.input.mode === 'touch');
    if (on) this.input.exitLock();
  }

  startMatch(opts) {
    if (this.match) this.match.dispose();
    this.lobby.closeModals();
    this.lobby.show(false);
    show('queueTimer', false);
    this.chat.clear();
    try {
      this.match = new Match(this, opts);
    } catch (err) {
      console.error(err);
      this.match = null;
      this.session.endMatch();
      this.lobby.show(true);
      toast('Failed to start match');
      return;
    }
    this.input.enabled = true;
    Audio.init(); Audio.resume();
    if (this.input.mode === 'kbm') { this.pause(true); $('pauseHint').textContent = 'Match ready — click Resume (or anywhere) to lock the mouse.'; this.input.requestLock(); }
    else this.pause(false);
    $('btnResume').textContent = 'PLAY';
  }

  leaveMatch(reason) {
    if (!this.match) return;
    const m = this.match;
    this.match = null;
    clearInterval(this._bg);
    m.dispose();
    this.session.endMatch();
    this.input.enabled = false; this.input.exitLock();
    this.paused = false; show('pause', false);
    this.touch.setActive(false);
    this.hud.exitMatch();
    this.chat.clear();
    this.chat.setContext('lobby', (text) => this.pm.chat(text));
    this.lobby.show(true);
    $('btnResume').textContent = 'RESUME';
    if (reason) toast(reason, 3500);
  }

  loop(tMs) {
    requestAnimationFrame(this._loop);
    const t = tMs / 1000;
    const el = t - this.lastT;
    this.lastT = t;
    // 60 FPS cap: on 90/120/144 Hz screens skip frames so work stays at a locked 60 Hz budget
    this.frameAcc += el;
    const interval = 1 / 60;
    if (this.frameAcc < interval - 0.002) return;
    const dt = Math.min(0.1, this.frameAcc);
    this.frameAcc = this.frameAcc > interval * 2 ? 0 : Math.max(0, this.frameAcc - interval);
    this.frameDt = dt;
    this.renderer.info.reset();
    if (this.match) {
      if (this.paused) this.match.ws && (this.input.state.lookDX = this.input.state.lookDY = 0);
      this.match.update(dt);
      if (this.match) this.match.render(this.renderer);
    } else {
      this.lobbyScene.update(dt);
      this.lobbyScene.render(this.renderer);
      if (this.lobby) this.lobby.frame();
    }
  }
}

window.__app = new App();
