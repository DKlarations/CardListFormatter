/** In-memory Redis fixture with CAS atomicity and an explicit interleaving hook. */
export class FakePullListRedis {
  values = new Map();
  ttls = new Map();
  zsets = new Map();
  beforeCompareAndSet = null;
  beforeCreate = null;

  async get(key) { return structuredClone(this.values.get(key) ?? null); }
  async set(key, value, options = {}) {
    if (options.nx && this.values.has(key)) return null;
    this.values.set(key, JSON.parse(JSON.stringify(value)));
    if (options.ex) this.ttls.set(key, options.ex);
    return "OK";
  }
  async del(...keys) {
    keys.forEach((key) => { this.values.delete(key); this.ttls.delete(key); });
    return keys.length;
  }
  async expire(key, seconds) { this.ttls.set(key, seconds); return 1; }
  async zadd(key, { score, member }) {
    const entries = this.zsets.get(key) || new Map();
    entries.set(member, score);
    this.zsets.set(key, entries);
    return 1;
  }
  async zrange(key, start, stop, options = {}) {
    const entries = Array.from(this.zsets.get(key)?.entries() || []);
    entries.sort((left, right) => options.rev ? right[1] - left[1] : left[1] - right[1]);
    return entries.slice(start, stop + 1).map(([member]) => member);
  }
  async zrem(key, ...members) {
    members.forEach((member) => this.zsets.get(key)?.delete(member));
    return members.length;
  }
  async eval(script, keys, args) {
    if (script.startsWith("-- pull-list-job:create")) {
      if (this.beforeCreate) {
        const hook = this.beforeCreate;
        this.beforeCreate = null;
        await hook({ keys, args });
      }
      if (this.values.has(keys[1])) return "duplicate";
      if (this.values.has(keys[0])) return "retry";
      const [serialized, id, ttl, score] = args;
      this.values.set(keys[0], JSON.parse(serialized));
      this.values.set(keys[1], id);
      this.ttls.set(keys[0], ttl);
      this.ttls.set(keys[1], ttl);
      for (const key of keys.slice(2)) {
        const entries = this.zsets.get(key) || new Map();
        entries.set(id, score);
        this.zsets.set(key, entries);
        this.ttls.set(key, ttl);
      }
      return "created";
    }
    if (script.trimStart().startsWith("if redis.call('GET', KEYS[1]) == ARGV[1]")) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.delete(keys[0]);
      this.ttls.delete(keys[0]);
      return 1;
    }
    if (script.startsWith("-- pull-list-job:read-snapshot")) {
      return this.values.has(keys[0]) ? `raw:${JSON.stringify(this.values.get(keys[0]))}` : null;
    }
    if (!script.startsWith("-- pull-list-job:compare-and-set")) throw new Error("Unsupported Redis fixture script.");
    if (this.beforeCompareAndSet) {
      const hook = this.beforeCompareAndSet;
      this.beforeCompareAndSet = null;
      await hook({ keys, args });
    }
    if (!this.values.has(keys[0])) return "not-found";
    if (JSON.stringify(this.values.get(keys[0])) !== args[0]) return "retry";
    const [expected, replacement, ttl, id, score, mode, newCount] = args;
    const owner = this.values.get(keys[1]);
    if (mode === "full" && owner && owner !== id) return "duplicate";
    this.values.set(keys[0], JSON.parse(replacement));
    this.ttls.set(keys[0], ttl);
    if (mode === "full") {
      this.values.set(keys[1], id);
      this.ttls.set(keys[1], ttl);
      if (keys[1] !== keys[2] && this.values.get(keys[2]) === id) {
        this.values.delete(keys[2]);
        this.ttls.delete(keys[2]);
      }
    } else if (owner === id) this.ttls.set(keys[1], ttl);
    for (const key of keys.slice(3, 3 + newCount)) {
      const entries = this.zsets.get(key) || new Map();
      entries.set(id, score);
      this.zsets.set(key, entries);
      this.ttls.set(key, ttl);
    }
    for (const key of keys.slice(3 + newCount)) this.zsets.get(key)?.delete(id);
    return "updated";
  }
}
