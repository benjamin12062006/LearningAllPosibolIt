import { describe, expect, it } from '@jest/globals';
import { WorkerLoop } from '../../../src/jobs/worker-loop.js';

const MANUAL = { autoStart: false, pollMs: 60_000, shutdownMs: 50 };
const AUTOMATIC = { autoStart: true, pollMs: 60_000, shutdownMs: 50 };

/** Una promesa que la prueba resuelve cuando quiere. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WorkerLoop (jobs&files E1, D2)', () => {
  it('shares one pass between concurrent runUntilIdle calls', async () => {
    const gate = deferred();
    let passes = 0;
    const loop = new WorkerLoop(
      MANUAL,
      async () => {
        passes += 1;
        await gate.promise;
      },
      () => undefined,
    );

    const first = loop.runUntilIdle();
    const second = loop.runUntilIdle();
    expect(second).toBe(first);
    gate.resolve();
    await first;

    expect(passes).toBe(1);
  });

  it('starts a new pass once the previous one finished', async () => {
    let passes = 0;
    const loop = new WorkerLoop(
      MANUAL,
      async () => {
        passes += 1;
      },
      () => undefined,
    );

    await loop.runUntilIdle();
    await loop.runUntilIdle();

    expect(passes).toBe(2);
  });

  it('runFreshPass waits for the running pass and then starts a new one', async () => {
    const gate = deferred();
    let passes = 0;
    const loop = new WorkerLoop(
      MANUAL,
      async () => {
        passes += 1;
        if (passes === 1) await gate.promise;
      },
      () => undefined,
    );

    const first = loop.runUntilIdle();
    const fresh = loop.runFreshPass();
    gate.resolve();
    await first;
    await fresh;

    expect(passes).toBe(2);
  });

  it('does not wake on its own when autoStart is off', async () => {
    let passes = 0;
    const loop = new WorkerLoop(
      MANUAL,
      async () => {
        passes += 1;
      },
      () => undefined,
    );

    loop.start();
    loop.wake();
    await Promise.resolve();

    expect(passes).toBe(0);
    await loop.stop();
  });

  it('reports a failed pass without rejecting wake', async () => {
    const reported = deferred();
    const loop = new WorkerLoop(
      AUTOMATIC,
      () => Promise.reject(new Error('queue down')),
      () => reported.resolve(),
    );

    loop.wake();
    await reported.promise;
    await loop.stop();
  });

  it('waits for a pass that ends before shutdownMs without aborting it', async () => {
    const seen: boolean[] = [];
    const loop: WorkerLoop = new WorkerLoop(
      { ...MANUAL, shutdownMs: 1_000 },
      (): Promise<void> =>
        loop.runJob(async (signal) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          seen.push(signal.aborted);
        }),
      () => undefined,
    );

    const pass = loop.runUntilIdle();
    const stop = await loop.stop();
    await pass;

    expect(stop).toEqual({ aborted: false });
    expect(seen).toEqual([false]);
  });

  it('aborts the running job after shutdownMs and waits for it to end', async () => {
    const finished: string[] = [];
    const loop: WorkerLoop = new WorkerLoop(
      MANUAL,
      (): Promise<void> =>
        loop.runJob(
          (signal) =>
            new Promise<void>((resolve) => {
              signal.addEventListener('abort', () => {
                finished.push('aborted');
                resolve();
              });
            }),
        ),
      () => undefined,
    );

    void loop.runUntilIdle();
    const stop = await loop.stop();

    expect(stop).toEqual({ aborted: true });
    expect(finished).toEqual(['aborted']);
  });

  it('hands an aborted signal to a job that starts while stopping', async () => {
    const loop = new WorkerLoop(
      MANUAL,
      async () => undefined,
      () => undefined,
    );
    await loop.stop();

    const aborted = await loop.runJob(async (signal) => signal.aborted);

    expect(aborted).toBe(true);
    expect(loop.isStopping()).toBe(true);
  });

  it('runs nothing after stop', async () => {
    let passes = 0;
    const loop = new WorkerLoop(
      MANUAL,
      async () => {
        passes += 1;
      },
      () => undefined,
    );

    await loop.stop();
    await loop.runUntilIdle();

    expect(passes).toBe(0);
  });
});
