import { defineConfig } from "vitest/config";

/**
 * The tuning bench, kept out of `npm test`.
 *
 * `*.harness.ts` files are simulations that take minutes and print tables for a
 * person to read; they are not assertions and must not gate a commit. The base
 * config's default `include` never matches them, so the only way to run one is
 * through this config.
 *
 * It repeats the base config's pool choice rather than importing it: a forked
 * child process has its own event loop, and a run that simulates twenty years
 * in one unbroken stretch would otherwise starve the reporter and be killed as
 * a hung worker rather than finishing.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.harness.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
    pool: "forks",
    // One long CPU-bound run per file; extra workers only contend for cores.
    maxWorkers: 1,
    // A bench is watched while it runs, so its tables are wanted as they print
    // rather than buffered to the end.
    disableConsoleIntercept: true,
  },
});
