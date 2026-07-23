export class DailyBudget {
  constructor({ limit = Infinity, date = () => new Date().toISOString().slice(0, 10) } = {}) {
    this.limit = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : Infinity;
    this.date = date;
    this.currentDate = date();
    this.used = 0;
    this.usedByProvider = {};
  }

  resetIfNeeded() {
    const current = this.date();
    if (current !== this.currentDate) {
      this.currentDate = current;
      this.used = 0;
      this.usedByProvider = {};
    }
  }

  tryConsume(provider = 'unknown', amount = 1) {
    this.resetIfNeeded();
    const units = Math.max(1, Number(amount) || 1);
    if (this.used + units > this.limit) return false;
    this.used += units;
    this.usedByProvider[provider] = (this.usedByProvider[provider] || 0) + units;
    return true;
  }

  snapshot() {
    this.resetIfNeeded();
    return {
      date: this.currentDate,
      limit: this.limit,
      used: this.used,
      remaining: Number.isFinite(this.limit) ? Math.max(0, this.limit - this.used) : Infinity,
      usedByProvider: { ...this.usedByProvider },
    };
  }
}

