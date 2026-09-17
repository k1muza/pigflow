import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /**
     * Most of what this suite asserts is the output of a herd simulated day by
     * day over years, which is seconds of work rather than the milliseconds
     * vitest allows for by default. Individual cases still set their own where
     * they need longer; this is only so that an ordinary simulation test does
     * not fail for being a simulation when the machine is busy.
     */
    testTimeout: 60_000,
    /**
     * These tests are pure CPU with no I/O to yield on, so running one per
     * logical core starves the worker's own reporting channel and vitest falls
     * over with "Timeout calling onTaskUpdate" rather than a test failure.
     * Leaving cores free costs nothing in wall time — the work is the same —
     * and it is the difference between a suite that passes and one that fails
     * at random.
     */
    maxWorkers: 4,
    /**
     * Child processes rather than worker threads. A test that simulates a herd
     * for five years holds its thread in one unbroken synchronous run, and a
     * worker thread that never yields cannot answer the reporter, which vitest
     * reports as "Timeout calling onTaskUpdate" and counts as the whole file
     * failing. A forked process has its own event loop and does not starve.
     */
    pool: "forks",
  },
});
