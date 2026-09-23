import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

/**
 * Next inlines `NEXT_PUBLIC_*` at build time, but only where it can see the
 * whole expression, so each one is written out in full rather than looked up
 * from a list of names.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Whether this build was given a project to talk to. Without one the planner
 * keeps every plan in this browser exactly as it did before Firestore existed,
 * so the app still runs for anyone who clones the repo without credentials.
 */
export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

/**
 * Set to a host like `127.0.0.1` to talk to `firebase emulators:start` instead
 * of the real project, so development and tests never touch the shared plans.
 */
const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST;

export type FirebaseHandles = { app: FirebaseApp; db: Firestore; auth: Auth };

let handles: Promise<FirebaseHandles | null> | null = null;

/**
 * Loads the SDK the first time it is actually needed. The imports are dynamic
 * so a build with no project configured never pays for Firestore in its bundle,
 * and so nothing touches IndexedDB while the page is being rendered on a server.
 */
export function getFirebase(): Promise<FirebaseHandles | null> {
  if (!firebaseConfigured || typeof window === "undefined") return Promise.resolve(null);
  handles ??= connect();
  return handles;
}

async function connect(): Promise<FirebaseHandles | null> {
  try {
    const [{ getApps, initializeApp }, firestore, { getAuth }] = await Promise.all([
      import("firebase/app"),
      import("firebase/firestore"),
      import("firebase/auth"),
    ]);

    const app = getApps()[0] ?? initializeApp(firebaseConfig);

    // Offline support. The cache answers reads from IndexedDB when the network
    // is gone and queues writes until it returns, and the multi-tab manager lets
    // two tabs of the planner share one cache instead of fighting over the lock.
    const db = firestore.initializeFirestore(app, {
      localCache: firestore.persistentLocalCache({
        tabManager: firestore.persistentMultipleTabManager(),
      }),
      /**
       * A field set to undefined is a field the plan does not have.
       *
       * Firestore's default is to refuse the whole write, and it refuses it by
       * throwing out of `batch.set` — so one optional field left empty anywhere
       * in one plan would stop every plan in the workspace from being saved,
       * and the only sign of it would be a badge saying "Not syncing". A plan
       * is JSON everywhere else in this app, where an absent field and an
       * undefined one are the same thing; this makes Firestore agree.
       */
      ignoreUndefinedProperties: true,
    });
    const auth = getAuth(app);

    if (emulatorHost) {
      firestore.connectFirestoreEmulator(db, emulatorHost, 8080);
      const { connectAuthEmulator } = await import("firebase/auth");
      connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    }

    return { app, db, auth };
  } catch (error) {
    console.error("PigFlow could not reach Firebase; plans stay on this device.", error);
    return null;
  }
}

