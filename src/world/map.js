import * as THREE from 'three';
import { buildTerrain, groundH, WATER_Y, LAKE, PLAY_RADIUS } from './terrain.js';
import { buildSky, buildMountains, SUN_DIR, SKY } from './sky.js';
import { buildWater } from './water.js';
import { buildGrass, buildFlowers, buildBushes, WIND } from './vegetation.js';
import { buildProps, treeTime } from './props.js';
import { CollisionWorld } from './collision.js';

// Sunvale Meadow: assembles the scene, lighting and collision for a quality level.
export const QUALITY = {
  low: { grass: 16000, flowers: 1000, shadow: 1024, shadows: false, bloom: false, msaa: 0, bushes: 60 },
  medium: { grass: 40000, flowers: 2200, shadow: 2048, shadows: true, bloom: true, msaa: 4, bushes: 140 },
  high: { grass: 75000, flowers: 3600, shadow: 4096, shadows: true, bloom: true, msaa: 4, bushes: 240 },
  ultra: { grass: 120000, flowers: 5200, shadow: 4096, shadows: true, bloom: true, msaa: 8, ao: true, bushes: 340 },
};

export class GameMap {
  constructor(quality = 'high') {
    const Q = QUALITY[quality] || QUALITY.high;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY.fog, 70, 650);
    this.world = new CollisionWorld();
    this.world.water = { x: LAKE.x, z: LAKE.z, r: LAKE.r + 8, y: WATER_Y };
    this.waterY = WATER_Y;
    const s = this.scene;

    // lighting: warm low sun, sky/ground bounce
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a6a2c, 1.25);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
    this.sun.position.copy(SUN_DIR).multiplyScalar(80);
    this.sun.castShadow = Q.shadows;
    if (Q.shadows) {
      const sc = this.sun.shadow.camera;
      sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 220;
      this.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03; this.sun.shadow.radius = 3;
    }
    s.add(this.sun); s.add(this.sun.target);

    this.sky = buildSky(); s.add(this.sky);
    s.add(buildMountains());
    this.terrain = buildTerrain(); s.add(this.terrain);
    this.water = buildWater(); s.add(this.water);
    this.props = buildProps(this.world, quality); s.add(this.props);
    const avoid = this.props.userData.avoid;
    this.grass = buildGrass(Q.grass, avoid); s.add(this.grass);
    this.flowers = buildFlowers(Q.flowers, avoid); s.add(this.flowers);
    this.bushes = buildBushes(Q.bushes, this.props.userData.anchors, avoid); s.add(this.bushes);
    this.altar = this.props.userData.altar;
    this.spawns = this._spawns();
    this.time = 0;
  }

  _spawns() {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.13;
      for (let tries = 0; tries < 12; tries++) {
        const r = 38 + (tries % 4) * 4 + (i % 2) * 6;
        const x = Math.cos(a + tries * 0.05) * r, z = Math.sin(a + tries * 0.05) * r;
        const y = groundH(x, z);
        if (this.world.inWater(x, z) > 0) continue;
        const p = { x, y: this.world.groundAt(x, z, y + 3), z };
        const test = new THREE.Vector3(x, p.y, z);
        if (this.world.resolve(test, 0.6, 1.8)) continue;
        p.yaw = Math.atan2(-x, -z); // face the center
        pts.push(p); break;
      }
    }
    return pts;
  }

  _pollen() {
    const n = 500;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * 60; p[i * 3 + 1] = Math.random() * 6; p[i * 3 + 2] = (Math.random() - 0.5) * 60; ph[i] = Math.random() * 100; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */`
        attribute float phase; uniform float uTime; uniform vec3 uCenter; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.3 + phase) * 1.5 + uTime * 0.6; p.z += cos(uTime * 0.23 + phase * 1.3) * 1.5 + uTime * 0.25; p.y += sin(uTime * 0.5 + phase) * 0.6;
          // wrap around the camera
          p.xz = uCenter.xz + mod(p.xz - uCenter.xz + 30.0, 60.0) - 30.0;
          p.y += uCenter.y - 1.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(22.0 / -mv.z, 1.0, 5.0);
          vA = (0.5 + 0.5 * sin(uTime * 2.0 + phase * 7.0)) * smoothstep(40.0, 5.0, -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(1.0, 0.95, 0.75, vA * 0.7 * smoothstep(0.5, 0.0, d)); }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }

  // focus = camera target (shadows follow it)
  update(dt, camera, focus, pushers) {
    this.time += dt;
    WIND.uTime.value = this.time; treeTime.value = this.time;
    this.sky.material.uniforms.uTime.value = this.time;
    this.sky.position.copy(camera.position);
    this.water.material.uniforms.uTime.value = this.time;
    if (focus) {
      // snap the shadow camera to texels to avoid shimmering
      const f = this.sun.shadow.mapSize.x / 72;
      const fx = Math.round(focus.x * f) / f, fz = Math.round(focus.z * f) / f;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIR, 90);
    }
    if (pushers) {
      const arr = WIND.uPush.value;
      for (let i = 0; i < 8; i++) {
        const p = pushers[i];
        if (p) arr[i].set(p.x, p.y, p.z, 0.85); else arr[i].set(0, -999, 0, 0.01);
      }
    }
  }

  inBounds(x, z) { return Math.hypot(x, z) < PLAY_RADIUS + 18; }
}
