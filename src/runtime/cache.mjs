import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class MemorySearchCache {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(String(key));
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(String(key));
      return null;
    }
    return entry.value;
  }

  set(key, value, { ttlMs }) {
    this.entries.set(String(key), {
      value,
      expiresAt: this.now() + Math.max(1, Number(ttlMs) || 1),
    });
    return value;
  }

  snapshot() {
    return Object.fromEntries(this.entries);
  }
}

export class FileSearchCache extends MemorySearchCache {
  constructor({ file, now = Date.now } = {}) {
    super({ now });
    if (!file) throw new Error('cache file is required');
    this.file = path.resolve(file);
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
        this.entries = new Map(Object.entries(parsed.entries || {}));
      } catch {
        this.entries = new Map();
      }
    }
  }

  persist() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, entries: this.snapshot() }, null, 2)}\n`);
    renameSync(temporary, this.file);
  }

  get(key) {
    const had = this.entries.has(String(key));
    const value = super.get(key);
    if (had && !value) this.persist();
    return value;
  }

  set(key, value, options) {
    const result = super.set(key, value, options);
    this.persist();
    return result;
  }
}
