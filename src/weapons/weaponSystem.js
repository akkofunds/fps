import { WEAPONS } from './weaponDefs.js';

const DEG = Math.PI / 180;
const _hit = {};

// Direction from yaw/pitch (radians). Yaw 0 looks down -Z.
export function dirFromAngles(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * cp;
  return out;
}

// Shared bullet trace with wood penetration (one wall). Used by players and bots.
// traceEnts(o, d, maxT) → {t, ent, zone} | null ; cb receives impacts/hits.
export function traceShot(world, traceEnts, ox, oy, oz, dx, dy, dz, w, cb, range = 250) {
  let mul = 1, remain = range, ignore = null;
  let ex = ox + dx * range, ey = oy + dy * range, ez = oz + dz * range;
  for (let pass = 0; pass < 2; pass++) {
    const tw = world.raycast(ox, oy, oz, dx, dy, dz, remain, _hit, ignore);
    const he = traceEnts(ox, oy, oz, dx, dy, dz, Math.min(tw, remain));
    if (he) {
      ex = ox + dx * he.t; ey = oy + dy * he.t; ez = oz + dz * he.t;
      cb.hitEntity(he.ent, he.zone, mul, ex, ey, ez, dx, dy, dz, w);
      break;
    }
    if (tw === Infinity) { ex = ox + dx * remain; ey = oy + dy * remain; ez = oz + dz * remain; break; }
    const hx = _hit.x, hy = _hit.y, hz = _hit.z;
    ex = hx; ey = hy; ez = hz;
    cb.impact(hx, hy, hz, _hit.nx, _hit.ny, _hit.nz, _hit.mat, _hit.obj, w, mul);
    if (_hit.mat === 'wood' && pass === 0) {
      mul *= w.pen;
      const exitT = _hit.tExit + 0.02;
      ignore = _hit.obj;
      ox += dx * exitT; oy += dy * exitT; oz += dz * exitT; remain -= exitT;
      continue;
    }
    break;
  }
  return [ex, ey, ez];
}

// Local player's arsenal: ammo, fire timing, spread, AK spray pattern, recoil punch,
// Glock burst mode, sniper bolt + 2-stage scope, reload/draw timings.
export class WeaponSystem {
  constructor() {
    this.ammo = [null, { mag: 30, reserve: 90 }, { mag: 20, reserve: 120 }, { mag: 5, reserve: 20 }];
    this.slot = 1;
    this.nextFire = 0; this.reloadEnd = 0; this.reloadStart = 0; this.drawEnd = 0; this.boltEnd = 0; this.boltStart = 0;
    this.burstMode = false; this.burstLeft = 0; this.burstNext = 0;
    this.spray = 0; this.lastShot = -1;
    this.zoom = 0; this.rezoom = 0; this.lastZoom = 1.5;
    this.ads = 0; this.adsOn = false; // ADS progress 0..1 (eased via adsEase) and target for AK/Glock
    this.inspectStart = 0; this.inspectEnd = 0; this.lastShotT = -10;
    this.punchP = 0; this.punchY = 0; // degrees
    this.infinite = false;
    this.spreadNow = 0;
    this._dir = [0, 0, 0];
    this.shotsFired = 0;
  }
  get def() { return WEAPONS[this.slot]; }
  get reloading() { return this.reloadEnd > 0; }

  refill() { for (let i = 1; i <= 3; i++) { this.ammo[i].mag = WEAPONS[i].mag; this.ammo[i].reserve = WEAPONS[i].reserve; } this.reloadEnd = 0; }

  select(slot, now) {
    if (slot < 1 || slot > 3 || slot === this.slot) return false;
    this.slot = slot; this.reloadEnd = 0; this.zoom = 0; this.rezoom = 0; this.burstLeft = 0; this.spray = 0;
    this.ads = 0; this.adsOn = false; this.inspectEnd = 0; this.lastShotT = -10;
    this.drawEnd = now + WEAPONS[slot].draw;
    this.boltEnd = 0;
    return true;
  }

  startReload(now) {
    const a = this.ammo[this.slot], w = this.def;
    if (this.reloadEnd || a.mag >= w.mag || (a.reserve <= 0 && !this.infinite)) return false;
    this.reloadStart = now; this.reloadEnd = now + w.reload; this.zoom = 0; this.rezoom = 0; this.burstLeft = 0; this.adsOn = false; this.inspectEnd = 0;
    return true;
  }

  reloadProgress(now) { return this.reloadEnd ? (now - this.reloadStart) / (this.reloadEnd - this.reloadStart) : -1; }
  boltProgress(now) { return this.boltEnd > now ? (now - this.boltStart) / (this.boltEnd - this.boltStart) : -1; }
  drawProgress(now) { const w = this.def; return this.drawEnd > now ? 1 - (this.drawEnd - now) / w.draw : 1; }
  inspectProgress(now) { return this.inspectEnd > now ? (now - this.inspectStart) / (this.inspectEnd - this.inspectStart) : -1; }
  adsEase() { const t = this.ads; return t * t * (3 - 2 * t); }
  get scoped() { return this.slot === 3 && this.adsEase() > 0.92; }

  // camera zoom: AK/Glock blend to their ADS zoom; the sniper zooms in as the scope reaches the eye
  zoomFactor() {
    const e = this.adsEase(), w = this.def;
    if (this.slot === 3) { const z = this.zoom ? w.zooms[this.zoom - 1] : this.lastZoom; return 1 + (z - 1) * e * e * e; }
    return 1 + (w.adsZoom - 1) * e;
  }

  maxSpeed() {
    const w = this.def, e = this.adsEase();
    if (this.slot === 3) return w.speed + (w.scopedSpeed - w.speed) * e;
    return w.speed * (1 - (1 - w.adsSpeed) * e);
  }

  computeSpread(speed, onGround, crouched) {
    const w = this.def;
    const max = w.speed;
    let moveFrac = (speed - 0.34 * max) / (0.66 * max);
    moveFrac = moveFrac < 0 ? 0 : moveFrac > 1 ? 1 : moveFrac;
    const scoped = this.scoped;
    let s = scoped ? w.spreadScoped : w.spreadBase;
    s += moveFrac * w.spreadMove * (this.slot === 3 && !scoped ? 1.6 : 1);
    if (!onGround) s += w.spreadAir;
    if (crouched && onGround) s *= w.spreadCrouch;
    if (this.slot === 2 && this.burstMode) s = Math.max(s, w.burst.spread);
    if (this.slot === 1 && this.spray > 0) s += Math.min(1.1, this.spray * 0.05);
    if (this.slot !== 3) s *= 1 - 0.35 * this.adsEase(); // aiming down sights tightens the cone
    return s;
  }

  // Main per-frame update. ctx: {now, dt, fire, firePressed, altPressed, reloadPressed, speed, onGround, crouched, yaw, pitch, ex, ey, ez}
  // Returns events via `fireFn(dirX, dirY, dirZ)` for each bullet.
  update(ctx, fireFn, sfx) {
    const now = ctx.now, dt = ctx.dt, w = this.def, a = this.ammo[this.slot];
    // reload finish
    if (this.reloadEnd && now >= this.reloadEnd) {
      const need = w.mag - a.mag;
      const take = this.infinite ? need : Math.min(need, a.reserve);
      a.mag += take; if (!this.infinite) a.reserve -= take;
      this.reloadEnd = 0;
    }
    // sniper auto re-scope after bolt
    if (this.rezoom && now >= this.boltEnd && !this.reloadEnd) { this.zoom = this.rezoom; this.rezoom = 0; }

    if (ctx.reloadPressed && this.startReload(now)) sfx('reload');

    // ADS (right click). AK/Glock: hold or toggle; sniper: cycle scope 1.5x → 3.0x → hip.
    const blocked = !!this.reloadEnd || now < this.drawEnd;
    if (this.slot === 3) {
      if (ctx.altPressed && !blocked) { this.zoom = (this.zoom + 1) % 3; this.rezoom = 0; if (this.zoom) this.lastZoom = w.zooms[this.zoom - 1]; sfx('zoom'); }
    } else if (ctx.adsToggle) {
      if (ctx.altPressed && !blocked) this.adsOn = !this.adsOn;
    } else this.adsOn = !!ctx.altHeld;
    if (ctx.modePressed && this.slot === 2) { this.burstMode = !this.burstMode; sfx('mode'); }
    const target = blocked ? 0 : this.slot === 3 ? (this.zoom ? 1 : 0) : (this.adsOn ? 1 : 0);
    const rate = dt / w.adsTime;
    if (target > this.ads) this.ads = Math.min(target, this.ads + rate);
    else if (target < this.ads) this.ads = Math.max(target, this.ads - rate * 1.25);
    // inspect (F): only when idle at the hip
    if (ctx.inspectPressed && !blocked && now >= this.boltEnd && this.ads < 0.05) { this.inspectStart = now; this.inspectEnd = now + w.inspect; }
    if (this.inspectEnd && (now >= this.inspectEnd || this.ads > 0.05 || ctx.fire)) this.inspectEnd = 0;

    this.spreadNow = this.computeSpread(ctx.speed, ctx.onGround, ctx.crouched);
    // Auto weapons keep an exact cadence (nextFire += interval) and may fire more than once in
    // a slow frame, so low-FPS devices never drop rounds or break the spray pattern.
    let shots = 0;
    for (let guard = 0; guard < 4; guard++) {
      const ready = now >= this.nextFire && now >= this.drawEnd && !this.reloadEnd && now >= this.boltEnd;
      let shoot = false;
      if (this.slot === 2 && this.burstLeft > 0) {
        if (now >= this.burstNext && a.mag > 0 && !this.reloadEnd) {
          shoot = true; this.burstLeft--; this.burstNext = now + w.burst.gap;
          if (this.burstLeft === 0) this.nextFire = now + w.burst.cooldown;
        } else if (a.mag <= 0) this.burstLeft = 0;
      } else if (ready && (shots === 0 ? (w.auto ? ctx.fire || ctx.firePressed : ctx.firePressed) : ctx.fire)) {
        if (a.mag <= 0) {
          if (ctx.firePressed) sfx('empty');
          if (this.startReload(now)) sfx('reload');
        } else if (this.slot === 2 && this.burstMode) {
          this.burstLeft = w.burst.count - 1; this.burstNext = now + w.burst.gap; shoot = true;
          this.nextFire = now + w.burst.cooldown + w.burst.gap * 2;
        } else {
          shoot = true;
          this.nextFire = w.auto && this.nextFire > now - w.interval ? this.nextFire + w.interval : now + w.interval;
        }
      }
      if (!shoot) break;
      shots++;
      this._shoot(ctx, w, a, now, fireFn);
      if (!w.auto) break;
    }

    // recoil punch (view kick). AK: camera follows half of the pattern; recovers once the trigger is released.
    if (this.slot === 1) {
      if (now - this.lastShot > 0.6) this.spray = 0;
      else if (!ctx.fire && now - this.lastShot > 0.1 && this.spray > 0) this.spray = Math.max(0, this.spray - dt * 14);
      const idx = Math.min(w.pattern.length - 1, Math.floor(this.spray));
      const tp = this.spray > 0 ? w.pattern[idx][1] * w.punch : 0, ty = this.spray > 0 ? -w.pattern[idx][0] * w.punch : 0;
      const k = Math.min(1, dt * 18);
      this.punchP += (tp - this.punchP) * k; this.punchY += (ty - this.punchY) * k;
    } else {
      const k = Math.min(1, dt * 7);
      this.punchP -= this.punchP * k; this.punchY -= this.punchY * k;
    }
    return shots > 0;
  }

  _shoot(ctx, w, a, now, fireFn) {
    a.mag--;
    this.shotsFired++;
    // spray pattern offset (AK) or kick (others)
    let pYaw = 0, pPitch = 0;
    if (this.slot === 1) {
      const idx = Math.min(w.pattern.length - 1, Math.floor(this.spray));
      pYaw = w.pattern[idx][0]; pPitch = w.pattern[idx][1];
      this.spray = Math.floor(this.spray) + 1;
    }
    const spr = this.spreadNow * DEG;
    const r = Math.sqrt(Math.random()) * spr, th = Math.random() * Math.PI * 2;
    // AK: bullets land on raw aim + full pattern (camera shows half of it as punch).
    // Others: bullets follow 2x the current view punch, like Source.
    let by, bp;
    if (this.slot === 1) { by = ctx.yaw - pYaw * DEG; bp = ctx.pitch + pPitch * DEG; }
    else { by = ctx.yaw + this.punchY * DEG * 2; bp = ctx.pitch + this.punchP * DEG * 2; }
    by -= Math.cos(th) * r; bp += Math.sin(th) * r;
    dirFromAngles(by, bp, this._dir);
    fireFn(this._dir[0], this._dir[1], this._dir[2]);
    this.lastShot = now; this.lastShotT = now; this.inspectEnd = 0;
    if (this.slot !== 1) { this.punchP += w.kickPitch * w.punch; this.punchY += (Math.random() - 0.5) * 0.5; }
    if (this.slot === 3) {
      this.boltStart = now; this.boltEnd = now + w.interval;
      if (this.zoom) { this.rezoom = this.zoom; this.zoom = 0; }
    }
  }
}
