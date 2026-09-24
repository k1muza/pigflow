import Dexie, { type Table } from "dexie";

import type { PlannerConfig } from "./config";

/**
 * Browser persistence for deterministic simulation artefacts.
 *
 * The main worker result used to live only in React memory, and button-driven
 * artefacts such as a pig datasheet always launched another full farm run.
 * IndexedDB is a better fit than localStorage: results contain typed arrays and
 * can be several megabytes, and structured-clone storage preserves both.
 *
 * Entries are content-addressed by the complete config and namespaced by the
 * deployed build. The same inputs on a different model build are therefore a
 * cache miss rather than a stale forecast.
 */

type CachedArtifact = {
  id: string;
  kind: string;
  configHash: string;
  configJson: string;
  qualifier: string;
  savedAt: number;
  value: unknown;
};

class PigFlowCache extends Dexie {
  artifacts!: Table<CachedArtifact, string>;

  constructor() {
    super("pigflow-simulation-cache");
    this.version(1).stores({
      artifacts: "&id,kind,configHash,savedAt",
    });
  }
}

const BUILD_ID = process.env.NEXT_PUBLIC_PIGFLOW_BUILD_ID ?? "dev";
const CACHE_FORMAT = "v1";
/** Enough room for several scenarios and individual exports without growing forever. */
const MAX_ARTIFACTS = 96;

let database: PigFlowCache | null = null;

function db(): PigFlowCache | null {
  if (typeof indexedDB === "undefined") return null;
  if (database === null) database = new PigFlowCache();
  return database;
}

/**
 * Small deterministic hash for an IndexedDB key.
 *
 * The complete JSON is stored beside the hash and compared on every read, so a
 * hash collision becomes a cache miss rather than a wrong simulation.
 */
export function configCacheIdentity(config: PlannerConfig): {
  hash: string;
  json: string;
} {
  const json = JSON.stringify(config);
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    hash: (hash >>> 0).toString(16).padStart(8, "0") + "-" + json.length.toString(36),
    json,
  };
}

function artifactId(kind: string, hash: string, qualifier: string): string {
  return [CACHE_FORMAT, BUILD_ID, kind, hash, qualifier].join(":");
}

export async function readCachedArtifact<T>(
  kind: string,
  config: PlannerConfig,
  qualifier = "",
): Promise<T | null> {
  const store = db();
  if (store === null) return null;

  const identity = configCacheIdentity(config);
  try {
    const row = await store.artifacts.get(artifactId(kind, identity.hash, qualifier));
    if (!row || row.configJson !== identity.json) return null;
    return row.value as T;
  } catch {
    // Private browsing, quota policy or a blocked database should cost
    // performance, never correctness or availability.
    return null;
  }
}

export async function writeCachedArtifact<T>(
  kind: string,
  config: PlannerConfig,
  value: T,
  qualifier = "",
): Promise<void> {
  const store = db();
  if (store === null) return;

  const identity = configCacheIdentity(config);
  try {
    await store.artifacts.put({
      id: artifactId(kind, identity.hash, qualifier),
      kind,
      configHash: identity.hash,
      configJson: identity.json,
      qualifier,
      savedAt: Date.now(),
      value,
    });

    const count = await store.artifacts.count();
    if (count <= MAX_ARTIFACTS) return;
    const oldest = await store.artifacts
      .orderBy("savedAt")
      .limit(count - MAX_ARTIFACTS)
      .primaryKeys();
    if (oldest.length > 0) await store.artifacts.bulkDelete(oldest);
  } catch {
    // The simulation has already succeeded. A cache write is best-effort.
  }
}
