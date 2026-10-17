# Firebase setup: guest accounts

Guests **sign in with email and password to book online**. Firebase handles the accounts:

| Firebase product | What it stores |
| --- | --- |
| **Authentication** | Guest accounts (email + password, password-reset emails) |
| **Firestore** | `users/{uid}`: the guest's name and phone (pre-fills their next booking)<br>`users/{uid}/bookings/{ref}`: a read-only copy of each of their bookings and its status |

Bookings, payments and the admin stay on the Golden Stay server (SQLite), so double-booking protection and QR verification work exactly as before.

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

## 5. Let the server write booking copies to Firestore (recommended)

Sign-in checks work with just the project ID. To also copy bookings into each guest's Firestore account:

1. **Project settings (⚙) → Service accounts → Generate new private key → Generate key**. A `.json` file downloads.
2. **This file is a password for your whole project.** Keep it on the server only, never in the website, git or email. Store it outside the project folder if you can, e.g. `/etc/goldenstay/firebase-service-account.json`.
3. In the server's `.env`:
   ```
   FIREBASE_PROJECT_ID=goldenstay-b847e
   FIREBASE_SERVICE_ACCOUNT_FILE=/etc/goldenstay/firebase-service-account.json
   ```
4. Restart the server. It logs `Guest sign-in (Firebase): ON (goldenstay-b847e)`.

Without the file, the server logs that booking copies are off. Guests can still sign in, book, and see their bookings on **My account** (that page reads from the server).

## 6. Recommended hardening

- **Restrict the web API key** to your domains: [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials?project=goldenstay-b847e) → the "Browser key" → **Application restrictions: Websites** → add `https://goldenstay.in/*` and `http://localhost:5173/*`. (The key in `.env` is public by design. This just stops other sites from using it.)
- **Authentication → Templates**: set the sender name to "Golden Stay" for verification and password-reset emails.

---

## Environment variables

| Variable | Where | Secret? |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Build time (baked into the website) | **No.** Public by design; already set in `.env`. Rebuild (`npm run build`) after changing them. |
| `FIREBASE_PROJECT_ID` | Server | No |
| `FIREBASE_SERVICE_ACCOUNT_FILE` | Server | **Yes** (path to the private key file) |

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
