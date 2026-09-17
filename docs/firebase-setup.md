# Putting PigFlow's plans in the cloud

PigFlow keeps its plans in Cloud Firestore so that a plan built on the farm can be
opened by someone who is not there. There is **one shared set of plans**: everyone
who signs in sees the same list and may edit any of it. Nothing is scoped to a
person — the account is the door, not a filing cabinet.

There is **no sign-up**. You create each account in the Firebase console, so the
people who can read and change the plans are exactly the people you added.

The app works without any of this — with no Firebase project configured it keeps
plans in the browser, as it always did. Follow this only when you want the plans
shared.

You need to do the console steps yourself; they involve an account and a billing
choice that nobody else can make for you.

---

## Trying it without a Firebase project

You can run the whole thing against the local emulators instead of a real
project, which is the right way to develop:

```bash
npm run emulators          # needs a JDK; firebase-tools 14+ wants Java 21+
```

Then put the demo values in `.env.local` — any `demo-*` project id works
offline — and set `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1`. The emulator
loads `firestore.rules`, so you are testing the real rules.

Give yourself an account to sign in with, either in the emulator UI at
<http://127.0.0.1:4000/auth> or with one call:

```bash
curl -X POST -H "Content-Type: application/json"   -d '{"email":"you@example.com","password":"a-password","returnSecureToken":true}'   "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key"
```

## 1. Make the project

1. Go to <https://console.firebase.google.com> and **Add project**. Call it
   something like `pigflow`. Google Analytics is not needed — turn it off.
2. In the project, open **Build → Firestore Database → Create database**.
   - Pick the region closest to the farm and to whoever will be reading the
     plans. This cannot be changed later.
   - Start in **production mode**. The rules in this repo replace whatever it
     creates, and production mode means the database is never briefly open.
3. Open **Build → Authentication → Get started**, then the **Sign-in method**
   tab, and enable **Email/Password**. Leave "Email link" off; leave
   **Anonymous** off.
4. Still in Authentication, go to the **Users** tab and **Add user** for each
   person: their email and a first password. Tell them the password and let them
   change it with the "Forgotten your password?" link on the login page.

   Adding a user is the only way in. The app has no sign-up form, and the
   security rules reject anonymous sessions even if that provider is switched on
   by mistake.

## 2. Register the web app and copy its config

1. **Project settings** (the gear) **→ General → Your apps → Web (`</>`)**.
2. Give it a nickname. **Do not** tick Firebase Hosting unless you intend to host
   there.
3. Firebase shows a `firebaseConfig` object. Copy this repo's
   `.env.local.example` to `.env.local` and move the six values across:

   ```bash
   cp .env.local.example .env.local
   ```

   | Console field       | Variable                                       |
   | ------------------- | ---------------------------------------------- |
   | `apiKey`            | `NEXT_PUBLIC_FIREBASE_API_KEY`                 |
   | `authDomain`        | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`             |
   | `projectId`         | `NEXT_PUBLIC_FIREBASE_PROJECT_ID`              |
   | `storageBucket`     | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`          |
   | `messagingSenderId` | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`     |
   | `appId`             | `NEXT_PUBLIC_FIREBASE_APP_ID`                  |

   `.env.local` is not committed. Set the same six variables in your host's
   environment settings when you deploy — they are `NEXT_PUBLIC_`, so they are
   read at **build** time, and changing them means rebuilding.

## 3. Publish the security rules

`firestore.rules` in this repo is the real thing; the console's default rules are
not. Publish it before anyone uses the app:

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # pick the project you just made
firebase deploy --only firestore:rules
```

Or paste the contents of `firestore.rules` into **Firestore Database → Rules** in
the console and press **Publish**.

## 4. Check it

```bash
npm run dev
```

You should be sent to `/login`. Sign in with a user you added in step 1.4, and
you land on a plan of your own at `/projects/<plan-id>`. The badge in the header
then tells you where the plans are:

| Badge                  | Meaning                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `Stored on this device` | No project configured — `.env.local` is missing or empty.     |
| `Connecting…`          | Waiting for the first answer from Firestore.                  |
| `Saved … to the cloud` | Working, and the last edit is with everyone else.             |
| `Saved … on this device` | Offline. The edit is queued and will go up by itself.       |
| `Not syncing`          | Firestore refused or failed. See the browser console.         |

Then the real test: open the planner in a second browser (or on a phone on the
same network via your machine's LAN address). Edit a plan in one and it should
appear in the other within a second or so.

To check offline support, open DevTools → Network → **Offline**, edit a plan,
watch the badge go to `Saved … on this device`, then go back online and watch it
return to `Saved … to the cloud`. The edit goes up by itself; you do not have to
do anything.

**What offline does not cover: reloading the page.** Firestore's cache holds your
*plans*, not the planner itself, and this app ships no service worker — so
pressing reload with no connection gets the browser's "no internet" page. Offline
support means a tab that is already open keeps working, which is the case that
matters on a farm with a weak line. If you need the planner to survive a reload
with no network too, that is a service worker, and a separate piece of work.

---

## What to know before you rely on this

**Everyone you give an account to can read and change every plan.** The rules
deliberately do not scope plans to a person, because that is what "share my plans
with someone remote" asks for. So the question to ask before adding a user is not
"which plans should they see" — it is "should this person be able to edit the
farm's plans at all". There is no read-only account.

The six config values above ship inside the JavaScript bundle; they have to, for
the browser to talk to Firebase. That is fine — they are not credentials.
`firestore.rules` is what protects the plans, and it requires an email account
you created.

The login screen itself is only a courtesy: a browser cannot enforce anything,
and someone could skip it. What actually stops them is the rules, which is why
they check the sign-in provider rather than trusting the app.

If you later want per-person plans, that is a change to `firestore.rules` and to
the collection path — the plans would move under the owner's user ID.

**Two people editing the same plan settle on the last write.** Edits are merged
per plan, not per field, so two people on *different* plans both keep their work,
but two people editing the *same* plan at the same time will see one version win.
For the intended use — one person plans, others look and occasionally adjust —
this is fine.

**Cost.** A plan is a few kilobytes. Editing one writes a single document about
three times a second at most while someone is typing, and each reader takes one
read per change. Firestore's free tier (50,000 reads and 20,000 writes a day)
covers a small team comfortably; there is no need for a paid plan.
