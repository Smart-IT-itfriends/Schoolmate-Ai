class SlidingWindowRateLimiter {
  constructor(windowMs, maxEvents) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
    this.buckets = new Map();
  }

  hit(key, now = Date.now()) {
    const timestamps = (this.buckets.get(String(key)) || []).filter((ts) => now - ts < this.windowMs);
    if (timestamps.length >= this.maxEvents) {
      const retryAfterMs = this.windowMs - (now - timestamps[0]);
      this.buckets.set(String(key), timestamps);
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 0),
      };
    }

    timestamps.push(now);
    this.buckets.set(String(key), timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }
}

function createSlowModeLimiter(config) {
  const seconds = Number(config.globalChat?.slowModeSeconds || 4);
  const windowMs = Math.max(seconds, 1) * 1000;
  return new SlidingWindowRateLimiter(windowMs, 1);
}

module.exports = {
  SlidingWindowRateLimiter,
  createSlowModeLimiter,
};
