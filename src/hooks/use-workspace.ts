"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FIRST_PLAN_ID,
  PLANS_COLLECTION,
  mergeRemote,
  planChanges,
  readPlanRow,
  sameWorkspace,
  workspaceFromRows,
  type PlanRow,
} from "@/lib/cloud-plans";
import { firebaseConfigured, getFirebase } from "@/lib/firebase";
import { createWorkspace, loadWorkspace, saveWorkspace, type Workspace } from "@/lib/workspace";

export type SyncState =
  /** No project configured for this build: plans live in this browser only. */
  | "local"
  /** Waiting for the first answer from Firestore. */
  | "connecting"
  /** Reading from the on-device cache; edits are queued for when the network returns. */
  | "offline"
  /** In step with the shared plans. */
  | "synced"
  /** Firestore refused or failed; the plan on screen is still safe on this device. */
  | "error";

/** How long an edit rests before it is written, so typing is not a write per keystroke. */
const WRITE_DELAY_MS = 350;

/**
 * How long to wait for the server before falling back to this device. It only
 * runs out when the browser is offline and the cache is empty — a first visit
 * with no network — because any cached plan answers long before this.
 */
const FIRST_LOAD_TIMEOUT_MS = 6000;

/**
 * Holds the plans the app renders and keeps them level with the shared copy in
 * Firestore. Every plan is shared: there is one set of plans, and anyone with
 * the planner open sees the others' changes arrive.
 *
 * Nothing here blocks on the network. Firestore applies a write to its own cache
 * first and sends it when it can, so the planner stays usable on a bad line and
 * catches up by itself.
 */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(createWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncState>(firebaseConfigured ? "connecting" : "local");

  /** The plans as Firestore last reported them — what a write is compared against. */
  const remote = useRef<PlanRow[]>([]);
  /** The plans on screen, readable from the snapshot handler without going stale. */
  const shown = useRef(workspace);
  /** Whether the cloud has answered once. Until it has, nothing on screen is real. */
  const adopted = useRef(false);

  useEffect(() => {
    shown.current = workspace;
  }, [workspace]);

  // ------------------------------------------------------------------ reading

  useEffect(() => {
    if (!firebaseConfigured) {
      // Deferred so the first client render still matches the server's markup.
      const timeout = window.setTimeout(() => {
        const stored = loadWorkspace();
        if (stored) setWorkspace(stored);
        adopted.current = true;
        setHydrated(true);
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    let live = true;
    let stopListening: (() => void) | undefined;

    /**
     * Opens what this device has when the cloud has nothing to give: the plans
     * saved here before, or a first plan on the shared document so that two
     * people starting at once do not each seed one.
     */
    const openLocalCopy = () => {
      adopted.current = true;
      remote.current = [];
      setWorkspace(loadWorkspace() ?? createWorkspace(undefined, FIRST_PLAN_ID));
      setHydrated(true);
    };

    /** Opens the plans this device knows about when the network never answers. */
    const fallback = window.setTimeout(() => {
      if (!live || adopted.current) return;
      openLocalCopy();
      setSync("offline");
    }, FIRST_LOAD_TIMEOUT_MS);

    (async () => {
      const firebase = await getFirebase();
      if (!live) return;
      if (!firebase) {
        setSync("error");
        openLocalCopy();
        return;
      }

      // The planner only renders once somebody is signed in, so there is no
      // waiting to do here — the gate above has already done it.
      const { collection, onSnapshot } = await import("firebase/firestore");
      if (!live) return;

      stopListening = onSnapshot(
        collection(firebase.db, PLANS_COLLECTION),
        { includeMetadataChanges: true },
        (snapshot) => {
          const rows: PlanRow[] = [];
          snapshot.forEach((document) => {
            const row = readPlanRow(document.id, document.data());
            if (row) rows.push(row);
          });

          const fromCache = snapshot.metadata.fromCache;
          setSync(fromCache ? "offline" : "synced");

          if (!adopted.current) {
            const opened = workspaceFromRows(rows, loadWorkspace()?.activeId ?? null);
            if (opened) {
              // The shared plans exist, so this device shows them whole.
              remote.current = rows;
              adopted.current = true;
              setWorkspace(opened);
              setHydrated(true);
              return;
            }
            // Nothing there. Only the server may say so: an empty cache means
            // "not read yet", and seeding from that would duplicate the plans
            // everybody else is already working on.
            if (fromCache) return;
            openLocalCopy();
            return;
          }

          const merged = mergeRemote(shown.current, rows, remote.current);
          remote.current = rows;
          setWorkspace((current) => (sameWorkspace(current, merged) ? current : merged));
        },
        (error) => {
          console.error("PigFlow lost its connection to the shared plans.", error);
          if (!live) return;
          setSync("error");
          if (!adopted.current) openLocalCopy();
        },
      );
    })();

    return () => {
      live = false;
      window.clearTimeout(fallback);
      stopListening?.();
    };
  }, []);

  // ------------------------------------------------------------------ writing

  const flush = useCallback(async (target: Workspace) => {
    // A copy stays on this device either way: it is what opens the planner if
    // Firebase is ever unreachable, and it remembers which plan you had open.
    saveWorkspace(target);

    const changes = planChanges(target, remote.current);
    if (changes.writes.length === 0 && changes.deletes.length === 0) return;

    const firebase = await getFirebase();
    if (!firebase) {
      setSavedAt(stamp());
      return;
    }

    try {
      const uid = firebase.auth.currentUser?.uid ?? null;
      const { doc, serverTimestamp, writeBatch } = await import("firebase/firestore");
      const batch = writeBatch(firebase.db);

      for (const row of changes.writes) {
        batch.set(doc(firebase.db, PLANS_COLLECTION, row.id), {
          config: row.config,
          order: row.order,
          updatedAt: serverTimestamp(),
          updatedBy: uid ?? "unknown",
        });
      }
      for (const id of changes.deletes) {
        batch.delete(doc(firebase.db, PLANS_COLLECTION, id));
      }

      // Deliberately not awaited: offline this promise does not settle until the
      // network returns, but Firestore has already taken the write and the plan
      // is safe. Awaiting it would only make the planner look stuck.
      batch.commit().catch((error) => {
        console.error("PigFlow could not save to the shared plans.", error);
        setSync("error");
      });

      // Treat the write as the new baseline, so that a snapshot arriving late
      // cannot make the same edit look unsaved and start a loop of rewrites.
      const deleted = new Set(changes.deletes);
      const written = new Set(changes.writes.map((row) => row.id));
      remote.current = [
        ...remote.current.filter((row) => !deleted.has(row.id) && !written.has(row.id)),
        ...changes.writes,
      ];
      setSavedAt(stamp());
    } catch (error) {
      console.error("PigFlow could not save to the shared plans.", error);
      setSync("error");
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => void flush(workspace), WRITE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [workspace, hydrated, flush]);

  return { workspace, setWorkspace, hydrated, savedAt, sync };
}

function stamp(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
