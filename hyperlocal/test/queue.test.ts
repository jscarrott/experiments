import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimitedQueue } from '../place-proxy/queue.js';

/** A clock that only moves when the queue sleeps, so the tests take no real time. */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('runs tasks one at a time, in order', async () => {
  const clock = fakeClock();
  const queue = new RateLimitedQueue(0, clock.now, clock.sleep);
  const order: string[] = [];
  const slow = queue.run(async () => {
    await new Promise((r) => setImmediate(r));
    order.push('first');
  });
  const fast = queue.run(async () => {
    order.push('second');
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['first', 'second']);
});

test('leaves at least the minimum gap between upstream calls', async () => {
  const clock = fakeClock();
  const queue = new RateLimitedQueue(1000, clock.now, clock.sleep);
  const startedAt: number[] = [];
  const task = () => {
    startedAt.push(clock.now());
    return Promise.resolve();
  };
  await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
  assert.deepEqual(startedAt, [0, 1000, 2000]);
});

test('does not sleep when the gap has already elapsed', async () => {
  const clock = fakeClock();
  const queue = new RateLimitedQueue(1000, clock.now, clock.sleep);
  await queue.run(async () => {});
  clock.advance(5000);
  const before = clock.now();
  await queue.run(async () => {});
  assert.equal(clock.now(), before, 'a cached-through gap costs nothing');
});

test('one failing task does not poison the queue', async () => {
  // Overpass returning 429 must not wedge every later lookup.
  const clock = fakeClock();
  const queue = new RateLimitedQueue(0, clock.now, clock.sleep);
  await assert.rejects(queue.run(async () => { throw new Error('429'); }));
  assert.equal(await queue.run(async () => 'ok'), 'ok');
});
