import './ui/styles.css';
import './ui/extra.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { TouchControls } from './ui/touch.js';
import { AdminPanel, isAdminRoute, isAdmin, syncAdminPerks } from './ui/admin.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { loadIdentity, saveIdentity, loadSettings, saveSettings, randomTag } from './core/storage.js';
import { PeerManager } from './network/peerManager.js';
import { SessionController } from './game/session.js';
import { Match } from './game/match.js';
import { GameMap, QUALITY } from './world/map.js';
import { loadMageModel } from './character/characterModel.js';
import { MAGE_LIST } from './game/mages.js';
import { LobbyScene } from './ui/lobbyScene.js';
import { Lobby, promptNameDialog } from './ui/lobby.js';
import { Hud } from './ui/hud.js';
import { Chat } from './ui/chat.js';
import { $, show, toast } from './ui/dom.js';

// App shell: one renderer + bloom composer shared by the lobby showcase and matches, one
// Sunvale map instance (static) reused by both, and the lobby ⇄ match state machine.
const KEY_HIST = 'magebreak.history';

// first run: pick a graphics preset from the GPU string
export function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch { return ''; }
}
// integrated GPUs (incl. the small Radeon iGPU inside Ryzen 7000 desktop CPUs, which browsers
// sometimes pick instead of the graphics card)
const IGPU = /intel|iris|uhd|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d|680m|780m|610m/i;
const isIPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function detectQuality() {
  const r = gpuName();
  if (/swiftshader|llvmpipe|software|mali|adreno|powervr/i.test(r) || /Android|iPhone|CrOS/i.test(navigator.userAgent) || isIPad()) return 'low';
  if (IGPU.test(r)) return 'low';
  if (/apple/i.test(r)) return 'medium'; // Apple silicon Macs
  return 'medium'; // dedicated GPUs: medium + dynamic resolution; High/Ultra are opt-in
}

// colour grade (HDR, before tone mapping): gentle saturation/contrast lift + vignette
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.1 }, uContrast: { value: 1.05 }, uVig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVig; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.18) * uContrast + 0.18;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVig * smoothstep(0.35, 0.85, length(d * vec2(1.1, 1.0)));
      gl_FragColor = vec4(max(c.rgb, 0.0), c.a);
    }`,
};

class App {
  constructor() {
    this.canvas = $('game');
    this.settings = loadSettings();
    if (!QUALITY[this.settings.quality]) this.settings.quality = detectQuality();
    const Q = QUALITY[this.settings.quality];
    // low (Chromebooks): no MSAA on the default framebuffer — it's a big fill-rate cost on iGPUs
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.settings.quality !== 'low', powerPreference: 'high-performance', stencil: false });
    this.dynScale = 1; this._perf = { t: 0, n: 0, good: 0, cool: 0 };
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = Q.shadows;
    this.renderer.shadowMap.type = this.settings.quality === 'medium' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    // the sun's shadow map is re-rendered every other frame (half the shadow cost, invisible at 60 FPS)
    this.renderer.shadowMap.autoUpdate = false;
    this._frame = 0;
    this.gpu = gpuName();
    this.width = 1; this.height = 1; this.aspect = 1;
    this.input = new Input(this.canvas);
    this.chat = new Chat(this.input);
    this.hud = new Hud(this);
    this.match = null;
    this.paused = false;
    this.lobbyScene = new LobbyScene(this);
    this.touch = new TouchControls(this);
    this.admin = new AdminPanel(this);
    document.body.classList.toggle('touch', this.input.mode === 'touch');
    this.input.on('mode', (m) => { document.body.classList.toggle('touch', m === 'touch'); this.touch.setActive(!!this.match && m === 'touch' && !this.paused); });
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
    // re-apply what the auto-tuner learned last time on this device
    for (let i = 0; i < (this.settings.autoTier || 0); i++) this._degrade(true);
    if (IGPU.test(this.gpu) && !/Mac/.test(navigator.platform) && !isIPad()) setTimeout(() => toast('Your browser is using integrated graphics. For much smoother play, set your browser to use your graphics card (Windows: Settings → Display → Graphics → your browser → High performance).', 9000), 4000);
    this.progress(0.55, 'Summoning Pyro…');
    try { await Promise.all(MAGE_LIST.map((m) => loadMageModel(m.model))); } catch (e) { console.error(e); toast('Failed to load a character model.'); }
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
    this.session.on('queue', (q) => { if (this.match && this.match.cfg.queue) this.hud.queueState(q); });
    this.lobby = new Lobby(this);
    this.chat.setContext('lobby', (text) => this.pm.chat(text));
    this.lobby.show(true);
    this.pm.start();
    this.chat.system(`Welcome, ${id.name}#${id.tag}. Share your tag so friends can invite you.`);
    // admin lives inside the normal client: /admin opens the access check
    if (isAdminRoute()) this.admin.open();
    syncAdminPerks();
    if (isAdmin() || isAdminRoute()) this.lobby.showAdminBadge(() => this.admin.open());
    this._fps = { t: 0, n: 0 };
  }

  _setupComposer() {
    const Q = QUALITY[this.settings.quality];
    this.composer = null;
    if (!Q.bloom) return;
    const r = this.renderer;
    // MSAA in the HDR target keeps grass blades and silhouettes clean
    const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples: Q.msaa || 0 });
    this.composer = new EffectComposer(r, target);
    this.renderPass = new RenderPass(this.map.scene, this.lobbyScene.camera);
    this.composer.addPass(this.renderPass);
    this.gtao = null;
    if (Q.ao) {
      this.gtao = new GTAOPass(this.map.scene, this.lobbyScene.camera, this.width, this.height);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    this.bloomDiv = this.settings.quality === 'medium' ? 4 : 2;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width / this.bloomDiv, this.height / this.bloomDiv), 0.55, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(this.width, this.height);
  }

  renderScene(scene, camera) {
    if (this.renderer.shadowMap.enabled && (this._frame++ & 1) === 0) this.renderer.shadowMap.needsUpdate = true;
    if (this.composer && !this.noPost) {
      this.renderPass.scene = scene; this.renderPass.camera = camera;
      if (this.gtao) { this.gtao.scene = scene; this.gtao.camera = camera; }
      this.composer.render();
    }
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
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, true);
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); this.bloom.resolution.set(w / this.bloomDiv, h / this.bloomDiv); }
    this.touch && this.touch.setActive(!!this.match && this.input.mode === 'touch' && !this.paused);
    // keep the 3D mage centred in the visible lobby area (social sidebar may be hidden)
    const soc = document.getElementById('social');
    const panel = soc && getComputedStyle(soc).display !== 'none' && !soc.classList.contains('open') ? soc.offsetWidth : 0;
    this.lobbyScene.resize(w, h, panel);
    if (this.match) this.match.resize(w, h);
  }

  _bindMatchUi() {
    const input = this.input;
    input.on('lock', (locked) => {
      if (!this.match || input.mode === 'touch') return;
      if (locked) { if (this.paused) this.pause(false); return; }
      if (!this.chat.isOpen && !this.match.ended) this.pause(true);
    });
    input.on('escape', () => { if (this.match && !input.locked) this.pause(!this.paused); });
    $('btnResume').onclick = () => { this.pause(false); if (input.mode !== 'touch') input.requestLock(); };
    $('btnLeave').onclick = () => this.leaveMatch();
    $('btnPauseSettings').onclick = () => this.lobby.openSettings();
    $('pause').addEventListener('click', (e) => { if (e.target.id === 'pause') { this.pause(false); if (input.mode !== 'touch') input.requestLock(); } });
  }

  // render resolution: auto follows the device (Retina/4K screens render natively); Ultra
  // supersamples up to 2× — a 1080p screen renders at 4K and downsamples, so nothing looks pixelated
  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    const Q = QUALITY[this.settings.quality] || QUALITY.medium;
    const scale = Number(this.settings.renderScale) || 0;
    // base: native resolution up to the preset's cap (manual "Render resolution" overrides it)
    let base = scale > 0 ? scale * dpr : Math.min(dpr, Q.dpr);
    if (this.settings.quality === 'ultra' && !scale) base = Math.max(base, 2);
    // dynamic resolution: drops when the GPU can't hold 60 FPS, climbs back when it can
    return Math.max(0.5, Math.min(3, base * this.dynScale));
  }

  // Dynamic resolution scaling. Measures real frame rate over ~0.7 s windows; below 55 FPS the
  // render resolution steps down (to the preset's floor), sustained 59+ FPS steps it back up.
  _dynRes(dt) {
    if (this.settings.dynamicRes === false) return;
    const p = this._perf;
    p.t += dt; p.n++;
    if (p.t < 0.7) return;
    const fps = p.n / p.t; p.t = 0; p.n = 0;
    if (document.hidden) return;
    const Q = QUALITY[this.settings.quality] || QUALITY.medium;
    p.cool = Math.max(0, p.cool - 1);
    let next = this.dynScale;
    if (fps < 55 && this.dynScale > Q.minScale) { next = Math.max(Q.minScale, this.dynScale * (fps < 40 ? 0.8 : 0.9)); p.good = 0; p.cool = 6; }
    else if (fps >= 59) { p.good++; if (p.good >= 4 && p.cool === 0 && this.dynScale < 1) { next = Math.min(1, this.dynScale * 1.06); p.good = 0; } }
    else p.good = 0;
    if (Math.abs(next - this.dynScale) > 0.005) { this.dynScale = next; this.resize(); }
    // still slow at the resolution floor → the auto-tuner switches off the next most expensive
    // feature (remembered for next time on this device)
    if (fps < 50 && this.dynScale <= Q.minScale + 0.01 && !document.hidden) {
      p.slow = (p.slow || 0) + 1;
      if (p.slow >= 3 && this.settings.autoTune !== false) {
        p.slow = 0;
        if (this._degrade()) {
          this.settings.autoTier = (this.settings.autoTier || 0) + 1; this.saveSettings();
          this.dynScale = Math.min(1, this.dynScale * 1.25); this.resize();
          if (!this._tuneHint) { this._tuneHint = true; toast('Auto-tuning graphics for a smoother frame rate…', 3500); }
        }
      }
    } else p.slow = 0;
    this.lastFps = fps;
  }

  // One step down the "what costs the most for the least visual loss" ladder. Returns false when
  // nothing is left to turn off.
  _degrade(silent) {
    const steps = [
      () => { if (this.map.lodScale <= 0.75) return false; this.map.lodScale = 0.72; return true; },
      () => { if (!this.gtao || !this.gtao.enabled) return false; this.gtao.enabled = false; return true; },
      () => {
        if (!this.composer || !this.composer.renderTarget1.samples) return false;
        for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) { t.samples = 0; t.dispose(); }
        return true;
      },
      () => { if (this.map.lodScale <= 0.55) return false; this.map.lodScale = 0.52; return true; },
      () => {
        if (!this.renderer.shadowMap.enabled) return false;
        this.renderer.shadowMap.enabled = false; this.map.sun.castShadow = false;
        this.map.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
        return true;
      },
      () => {
        if (!this.composer || this.noPost) return false;
        this.noPost = true;
        if (this.match) this.match.fx.fire.mat.uniforms.uGain.value = 0.55;
        return true;
      },
      () => { if (this.map.lodScale <= 0.4) return false; this.map.lodScale = 0.38; return true; },
    ];
    for (const f of steps) if (f()) { if (!silent) console.info('auto-tune step'); return true; }
    return false;
  }

  pause(on) {
    this.paused = on;
    show('pause', on);
    this.input.enabled = !!this.match && !on;
    const touch = this.input.mode === 'touch';
    $('pauseHint').textContent = touch ? 'Tap Resume to keep playing.' : 'Click Resume to lock the mouse. Esc releases it.';
    this.touch.setActive(!!this.match && !on && touch);
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
    this.session.matchReady(m);
    if (m.cfg.queue) {
      this.hud.queueState({ searching: true, start: this.session.queueStart, found: (this.session.humans || []).length || m.players.length, size: 8 });
      $('btnLeave').textContent = 'LEAVE QUEUE';
    } else $('btnLeave').textContent = 'LEAVE MATCH';
    this.input.enabled = true;
    Audio.init(); Audio.resume();
    document.body.classList.add('in-match');
    this.touch.build(m.kit);
    if (this.input.mode === 'touch') {
      this.pause(false);
      try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch { /* ignore */ }
    } else {
      this.pause(true);
      $('pauseHint').textContent = 'Match ready — click RESUME (or anywhere) to lock the mouse.';
      this.input.requestLock();
    }
    $('btnResume').textContent = 'PLAY';
  }

  leaveMatch(reason, opts = {}) {
    if (!this.match) return;
    this.hud.queueState(null);
    const m = this.match;
    this.match = null;
    m.dispose();
    this.session.endMatch();
    this.input.enabled = false; this.input.exitLock();
    this.paused = false; show('pause', false);
    document.body.classList.remove('in-match');
    this.touch.setActive(false);
    this.hud.exitMatch();
    this.chat.clear();
    this.chat.setContext('lobby', (text) => this.pm.chat(text));
    this.lobbyScene.setActive(true);
    this.lobby.show(true);
    this.lobby.setTab('play');
    $('btnResume').textContent = 'RESUME';
    if (reason) toast(reason, 3500);
    if (opts.requeue) setTimeout(() => { if (!this.match && this.session && !this.session.busy) this.session.startQueue(); }, 600);
  }

  loop(tMs) {
    requestAnimationFrame(this._loop);
    const t = tMs / 1000;
    const dt = Math.min(0.05, Math.max(0.001, t - this.lastT));
    this.lastT = t;
    this._dynRes(dt);
    if (this.match) {
      this.match.update(dt);
      if (this.match) { this.touch.update(this.match); this.match.render(); }
    } else {
      this.lobbyScene.update(dt);
      this.renderScene(this.map.scene, this.lobbyScene.camera);
      if (this.lobby) this.lobby.frame();
    }
    if (this.admin.fpsOn) {
      const f = this._fps || (this._fps = { t: 0, n: 0 });
      f.t += dt; f.n++;
      if (f.t >= 0.5) {
        const i = this.renderer.info.render;
        $('fpsMeter').textContent = `${Math.round(f.n / f.t)} FPS\n${i.calls} calls · ${(i.triangles / 1000).toFixed(0)}k tris\n${this.renderer.domElement.width}×${this.renderer.domElement.height}`;
        f.t = 0; f.n = 0;
      }
    }
  }
}

window.__app = new App();
