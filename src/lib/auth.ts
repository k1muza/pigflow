import type { User } from "firebase/auth";
import { firebaseConfigured, getFirebase } from "./firebase";

/**
 * Who is signed in, reduced to what the planner actually uses. Nothing here
 * decides which plans a person can see — the plans are shared, and signing in
 * is the door rather than a filing cabinet.
 */
export type AppUser = {
  uid: string;
  email: string | null;
};

/** Whether this build has a sign-in at all. Without Firebase, the planner is open. */
export const signInRequired = firebaseConfigured;

function toAppUser(user: User | null): AppUser | null {
  return user ? { uid: user.uid, email: user.email } : null;
}

/**
 * Reports who is signed in now and whenever that changes, including the moment
 * Firebase finishes restoring a session from the last visit. Resolves to a
 * function that stops watching.
 *
 * A build with no Firebase project says "nobody, and we are finished looking",
 * which is what keeps the planner usable without credentials.
 */
export async function watchUser(
  onChange: (user: AppUser | null, ready: boolean) => void,
): Promise<() => void> {
  const firebase = await getFirebase();
  if (!firebase) {
    onChange(null, true);
    return () => {};
  }
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(firebase.auth, (user) => onChange(toAppUser(user), true));
}

/** The person signed in on this device right now, without waiting. */
export async function currentUser(): Promise<AppUser | null> {
  const firebase = await getFirebase();
  return firebase ? toAppUser(firebase.auth.currentUser) : null;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const firebase = await getFirebase();
  if (!firebase) throw new Error("no-firebase");
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  await signInWithEmailAndPassword(firebase.auth, email.trim(), password);
}

export async function signOutOfPlanner(): Promise<void> {
  const firebase = await getFirebase();
  if (!firebase) return;
  const { signOut } = await import("firebase/auth");
  await signOut(firebase.auth);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const firebase = await getFirebase();
  if (!firebase) throw new Error("no-firebase");
  const { sendPasswordResetEmail } = await import("firebase/auth");
  await sendPasswordResetEmail(firebase.auth, email.trim());
}

/**
 * Turns a Firebase error into something worth reading on the screen.
 *
 * Firebase answers a wrong password and an email it has never seen with the
 * same `invalid-credential`, on purpose: telling them apart would let anyone
 * discover who has an account here. The wording keeps that, rather than
 * guessing which it was.
 */
export function signInProblem(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password do not match an account.";
    case "auth/invalid-email":
      return "That does not look like an email address.";
    case "auth/missing-password":
      return "Enter your password.";
    case "auth/user-disabled":
      return "That account has been turned off. Ask whoever runs the planner.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes, or reset your password.";
    case "auth/network-request-failed":
      return "No connection. Check the network and try again.";
    case "auth/operation-not-allowed":
      return "Email sign-in is not switched on for this project yet.";
    default:
      return "Could not sign in. Try again, and see the browser console if it keeps failing.";
  }
}
