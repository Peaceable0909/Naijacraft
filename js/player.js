// First-person player: AABB collision against block shapes, walking, stepping onto slabs and stairs,
// swimming and creative flight.
import { B } from './blocks.js';

const HALF = 0.3;      // half width
export const BODY = 1.8;
export const EYE = 1.62;
const GRAVITY = 28;
const JUMP = 8.6;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.flying = false;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.moving = 0;          // horizontal speed, for animation and footsteps
    this.stepDist = 0;
  }

  // Does the body AABB at (x, y, z) overlap any solid shape?
  collides(x, y, z) {
    const w = this.world;
    const ax0 = x - HALF, ax1 = x + HALF, ay0 = y, ay1 = y + BODY, az0 = z - HALF, az1 = z + HALF;
    for (let j = Math.floor(ay0); j <= Math.floor(ay1 - 1e-6); j++) {
      for (let k = Math.floor(az0); k <= Math.floor(az1 - 1e-6); k++) {
        for (let i = Math.floor(ax0); i <= Math.floor(ax1 - 1e-6); i++) {
          const boxes = w.solidBoxes(i, j, k);
          if (!boxes) continue;
          for (const b of boxes) {
            if (ax1 > i + b[0] + 1e-6 && ax0 < i + b[3] - 1e-6 && ay1 > j + b[1] + 1e-6 && ay0 < j + b[4] - 1e-6 && az1 > k + b[2] + 1e-6 && az0 < k + b[5] - 1e-6) return true;
          }
        }
      }
    }
    return false;
  }

  intersectsBlock(bx, by, bz) {
    const { x, y, z } = this.pos;
    return x + HALF > bx && x - HALF < bx + 1 && y + BODY > by && y < by + 1 && z + HALF > bz && z - HALF < bz + 1;
  }

  // Move along one axis; returns true if blocked.
  moveAxis(axis, d, stepHeight) {
    const p = this.pos;
    const before = p[axis];
    p[axis] += d;
    if (!this.collides(p.x, p.y, p.z)) return false;
    if (axis !== 'y' && stepHeight > 0) {
      const oy = p.y;
      for (const h of [0.51, stepHeight]) {
        if (h > stepHeight) break;
        p.y = oy + h;
        if (!this.collides(p.x, p.y, p.z)) return false;
      }
      p.y = oy;
    }
    // back off to just before contact (binary search keeps this exact for partial blocks)
    let lo = 0, hi = d;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      p[axis] = before + mid;
      if (this.collides(p.x, p.y, p.z)) hi = mid; else lo = mid;
    }
    p[axis] = before + lo;
    return true;
  }

  toggleFly() {
    this.flying = !this.flying;
    this.vel.y = 0;
  }

  checkWater() {
    const w = this.world, { x, y, z } = this.pos;
    const at = (yy) => w.get(Math.floor(x), Math.floor(yy), Math.floor(z)) === B.WATER;
    this.inWater = at(y + 0.1) || at(y + 0.9);
    this.headInWater = at(y + EYE);
  }

  // input: { f, s, jump, down, sprint } with f/s in -1..1
  update(dt, input) {
    this.checkWater();
    const swim = this.inWater && !this.flying;
    const speed = this.flying ? (input.sprint ? 20 : 11) : swim ? 2.6 : input.sprint ? 7 : 4.5;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = sin * input.f + cos * input.s, wz = cos * input.f - sin * input.s;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }
    this.vel.x = wx * speed; this.vel.z = wz * speed;

    if (this.flying) {
      this.vel.y = ((input.jump ? 1 : 0) - (input.down ? 1 : 0)) * speed;
    } else if (swim) {
      this.vel.y = Math.max(this.vel.y - 9 * dt, -2.5);
      if (input.jump) this.vel.y = Math.min(this.vel.y + 24 * dt, 3.4);
    } else {
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -50);
      if (input.jump && this.onGround) this.vel.y = JUMP;
    }

    const stepHeight = this.flying ? 0 : (swim && input.jump) ? 1.05 : (this.onGround ? 0.51 : 0);
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt) / 0.4));
    const h = dt / steps;
    const sx = this.pos.x, sz = this.pos.z;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', this.vel.x * h, stepHeight);
      this.moveAxis('z', this.vel.z * h, stepHeight);
      const dy = this.vel.y * h;
      if (this.moveAxis('y', dy, 0)) { if (dy < 0) this.onGround = true; this.vel.y = 0; }
    }
    if (!this.onGround && this.vel.y <= 0 && !this.flying && this.collides(this.pos.x, this.pos.y - 0.02, this.pos.z)) this.onGround = true;
    if (this.flying && this.onGround) this.flying = false; // landing ends flight
    if (this.pos.y < -20) { this.pos.y = 5; this.vel.y = 0; }
    this.moving = dt > 0 ? Math.hypot(this.pos.x - sx, this.pos.z - sz) / dt : 0;
    this.checkWater();
  }
}
