// In-memory token bucket: `capacity` tokens, refilled at `perSec`. Used per connection for chat, edits and so on.
export class Bucket {
  constructor(capacity, perSec, now) {
    this.cap = capacity; this.rate = perSec; this.tokens = capacity; this.t = now;
  }

  take(n, now) {
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.t) / 1000) * this.rate);
    this.t = now;
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}
