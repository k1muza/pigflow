/**
 * A count of how many farms have been built.
 *
 * Simulating a herd day by day is the expensive thing this product does, and
 * the expensive mistake is doing it more than once for the same plan — which is
 * invisible from the outside, because three runs of the same config agree with
 * each other perfectly and only cost three times as much. So the two engines
 * each tick a counter when they are constructed, and a test can assert the
 * number rather than the timing.
 *
 * It is a counter and nothing else: no logging, no timers, no allocation per
 * day. Production pays one increment per farm for it.
 */
export type RunCounts = {
  /** 1.x farms built, the haulage probe run included. */
  farms: number;
  /** 2.0 engines built. */
  engines: number;
};

const counts: RunCounts = { farms: 0, engines: 0 };

export function countFarmBuilt(): void {
  counts.farms += 1;
}

export function countEngineBuilt(): void {
  counts.engines += 1;
}

/** Farms and engines built so far, of either kind. */
export function runCounts(): RunCounts {
  return { ...counts };
}

/** Both counters back to zero, so a test can measure one stretch of work. */
export function resetRunCounts(): void {
  counts.farms = 0;
  counts.engines = 0;
}
