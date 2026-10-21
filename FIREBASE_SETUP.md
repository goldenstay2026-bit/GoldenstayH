# Firebase setup: guest accounts

Guests **sign in with email and password to book online**. Firebase handles the accounts:

| Firebase product | What it stores |
| --- | --- |
| **Authentication** | Guest accounts (email + password, password-reset emails) |
| **Firestore** | `users/{uid}`: the guest's name and phone (pre-fills their next booking)<br>`users/{uid}/bookings/{ref}`: a read-only copy of each of their bookings and its status |

Bookings, payments, requests and the admin data are also stored in this Firestore database (collections such as `bookings`, `booking_nights`, `payments`), written only by the server with its service-account key; the security rules keep every browser out of them.

Your project **goldenstay-b847e** is already connected: its web config is in `.env`. Do these one-time steps in the [Firebase console](https://console.firebase.google.com/project/goldenstay-b847e).

---

## 1. Turn on email + password sign-in (required)

1. **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → switch on **Email/Password** (leave "Email link" off) → **Save**.

Without this, guests see "Email sign-in isn't enabled yet".

## 2. Add your website's domain (required before going live)

**Authentication → Settings → Authorized domains → Add domain**: e.g. `goldenstay.in`. `localhost` is already allowed for testing.

## 3. Create the Firestore database (required)

1. **Build → Firestore Database → Create database**.
2. Location: **asia-south1 (Mumbai)**, the closest to Guwahati. *This can't be changed later.*
3. Start in **production mode**. Our rules (next step) open only what's needed.

## 4. Publish the security rules (required)

The rules in `firestore.rules` let each guest read and edit **only their own** profile, and read (never change) their own booking copies. Everything else is closed. They're tested in `test/firestore-rules.test.ts`.

**Option A (simplest):** Firestore Database → **Rules** tab → replace everything with the contents of `firestore.rules` → **Publish**.

**Option B (command line):**

```bash
npx firebase login
npm run firebase:deploy-rules
```

## 5. Give the server its key to Firestore (required)

Firestore is the booking system's database, so the server needs a service-account key.

1. **Project settings (⚙) → Service accounts → Generate new private key → Generate key**. A `.json` file downloads.
2. **This file is a password for your whole project.** Never put it in the website, git or email.
3. **On Vercel:** open the file, copy all of it, and paste it as the value of `FIREBASE_SERVICE_ACCOUNT` (Project → Settings → Environment Variables). Mark it *Sensitive*.
   **On your own server:** store the file outside the project folder and set `FIREBASE_SERVICE_ACCOUNT_FILE=/etc/goldenstay/firebase-service-account.json`.
4. Also set `FIREBASE_PROJECT_ID=goldenstay-b847e`, then redeploy / restart.

For local development leave both empty: `npm run dev` starts the Firestore emulator instead, so your real bookings are never touched.

## 6. Recommended hardening

- **Restrict the web API key** to your domains: [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials?project=goldenstay-b847e) → the "Browser key" → **Application restrictions: Websites** → add `https://goldenstay.in/*` and `http://localhost:5173/*`. (The key in `.env` is public by design. This just stops other sites from using it.)
- **Authentication → Templates**: set the sender name to "Golden Stay" for verification and password-reset emails.

---

## Environment variables

| Variable | Where | Secret? |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Build time (baked into the website) | **No.** Public by design; already set in `.env`. Rebuild (`npm run build`) after changing them. |
| `FIREBASE_PROJECT_ID` | Server | No |
| `FIREBASE_SERVICE_ACCOUNT` | Server (Vercel) | **Yes** (the key JSON itself) |
| `FIREBASE_SERVICE_ACCOUNT_FILE` | Server (self-hosted) | **Yes** (path to the key file) |

Analytics (`measurementId`) is deliberately **not** enabled: it loads Google's tracking script and sets cookies. Ask if you want it.

## Testing

```bash
npm run dev:emulators   # whole site against local Firebase emulators — safe, no real accounts
                        # site http://localhost:5173 · emulator UI http://127.0.0.1:4000
npm run dev             # site against the REAL project (creates real accounts)
npm test                # server tests (fake Firebase)
npm run test:rules      # Firestore security-rules tests (Firestore emulator; needs Java 11+)
```

To check it live: open `/book/`, choose dates, **Create an account**, add your phone and book. Then see:

- Firebase console → **Authentication → Users**: the new account.
- **Firestore → users → (uid)**: name/phone, and `bookings/GS…` with its status.
- The site's **My account** page (`/account/`): the booking.
