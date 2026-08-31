/**
 * A serial queue that never lets two upstream calls run at once and never lets them
 * run closer together than `minGapMs`.
 *
 * This exists because Overpass and Photon are volunteer-run. Overpass's usage policy
 * budgets a few hundred moderate queries a day; Nominatim, which we avoid for exactly
 * this reason, caps at one per second. Rate limiting on our side is the price of using
 * someone else's infrastructure politely.
 *
 * The sleep function is injectable so the tests do not have to wait in real time.
 */
export class RateLimitedQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;

  constructor(
    private readonly minGapMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const wait = this.lastStart + this.minGapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      return task();
    });
    // The chain must not break when one task rejects, or every later call is poisoned
    // by an unrelated failure.
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
