// First-person player: AABB collision against the voxel grid, walking and creative flight.
const HALF = 0.3;      // half width
const HEIGHT = 1.8;
export const EYE = 1.62;
const GRAVITY = 28;
const JUMP = 8.6;
const EPS = 1e-4;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.flying = false;
    this.onGround = false;
  }

  collides(x, y, z) {
    const w = this.world;
    const i0 = Math.floor(x - HALF), i1 = Math.floor(x + HALF - 1e-6);
    const j0 = Math.floor(y), j1 = Math.floor(y + HEIGHT - 1e-6);
    const k0 = Math.floor(z - HALF), k1 = Math.floor(z + HALF - 1e-6);
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) if (w.isSolid(i, j, k)) return true;
    return false;
  }

  intersectsBlock(bx, by, bz) {
    const { x, y, z } = this.pos;
    return x + HALF > bx && x - HALF < bx + 1 && y + HEIGHT > by && y < by + 1 && z + HALF > bz && z - HALF < bz + 1;
  }

  moveAxis(axis, d) {
    const p = this.pos;
    p[axis] += d;
    if (!this.collides(p.x, p.y, p.z)) return false;
    if (axis === 'x') p.x = d > 0 ? Math.floor(p.x + HALF) - HALF - EPS : Math.floor(p.x - HALF) + 1 + HALF + EPS;
    else if (axis === 'z') p.z = d > 0 ? Math.floor(p.z + HALF) - HALF - EPS : Math.floor(p.z - HALF) + 1 + HALF + EPS;
    else p.y = d > 0 ? Math.floor(p.y + HEIGHT) - HEIGHT - EPS : Math.floor(p.y) + 1;
    return true;
  }

  toggleFly() {
    this.flying = !this.flying;
    this.vel.y = 0;
  }

  update(dt, keys) {
    const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
    const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    const shift = keys.ShiftLeft || keys.ShiftRight;
    const speed = this.flying ? 11 : shift ? 7 : 4.5;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = sin * f + cos * s, wz = cos * f - sin * s;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx = (wx / len) * speed; wz = (wz / len) * speed; }
    this.vel.x = wx; this.vel.z = wz;

    if (this.flying) {
      this.vel.y = ((keys.Space ? 1 : 0) - (shift ? 1 : 0)) * speed;
    } else {
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -50);
      if (keys.Space && this.onGround) this.vel.y = JUMP;
    }

    // sub-step so fast movement can't tunnel through blocks
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt) / 0.4));
    const h = dt / steps;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', this.vel.x * h);
      this.moveAxis('z', this.vel.z * h);
      const dy = this.vel.y * h;
      if (this.moveAxis('y', dy)) { if (dy < 0) this.onGround = true; this.vel.y = 0; }
    }
    if (this.flying && this.onGround) this.flying = false; // landing ends flight
    if (this.pos.y < -20) { this.pos.y = 5; this.vel.y = 0; } // safety net
  }
}
