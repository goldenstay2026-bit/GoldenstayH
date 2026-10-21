# Golden Stay — website, bookings & payments

Homestay website for Golden Stay, Maligaon, Guwahati. Built by Webro Studios.

- **Website**: React + TypeScript + Vite + Tailwind CSS v4 (prerendered homepage).
- **Server**: Node.js + Express, deployed as one **Vercel** function (`/api/*`). It also runs as a normal Node server (`npm start`).
- **Database**: **Cloud Firestore** (Firebase project `goldenstay-b847e`). Local development and tests use the Firestore emulator, never the real data.
- Guests can **send an enquiry** (form → instant Telegram message to the owner + a row in a Google Sheet; see **[NOTIFICATIONS_SETUP.md](NOTIFICATIONS_SETUP.md)**), use the WhatsApp/call buttons, or **book and pay online** by QR (`/book/`). Booking online requires a guest account (Firebase email + password) — see **[FIREBASE_SETUP.md](FIREBASE_SETUP.md)**; guests see their bookings at `/account/`.

## Commands

```bash
npm install
npm run dev          # API on :8787 + Vite on :5173 (open http://localhost:5173); starts the Firestore emulator when no key is set
npm run dev:emulators # same, but Auth is emulated too (no real accounts)
npm test             # 127 server tests on the Firestore emulator (pricing, availability, double booking, gateway, QR, admin, requests, emails, sign-in, security)
npm run test:rules   # 10 Firestore security-rules tests (Firestore emulator)
npm run build        # type-check, build all pages, prerender the homepage into dist/
npm run vercel-build # build + package for Vercel into .vercel/output (what Vercel runs)
node scripts/vercel-local.mjs        # serve .vercel/output locally, the way Vercel does
npm start            # self-hosted server: serves dist/ + /api on PORT (default 8787)
npm run admin:hash   # create the backup admin password hash
npm run images       # regenerate WebP 400/800/1600w from public/images/*
```

Requires **Node.js 22.13+**. The tests and `npm run dev` start the Firestore emulator, which needs **Java 11+** installed.

## Deploying on Vercel

The repo builds itself for Vercel (`vercel.json` → `npm run vercel-build`, Vercel's Build Output API): the pages go to Vercel's CDN, and every `/api/*` request runs the server as one Node.js function.

1. **Firestore**: in the Firebase console (project `goldenstay-b847e`) make sure Firestore is created (Native mode, region e.g. `asia-south1`). Deploy the rules once: `npm run firebase:deploy-rules`.
2. **Service-account key**: Firebase console → Project settings → Service accounts → *Generate new private key*. Keep the JSON file private.
3. **Vercel project**: *Add New → Project*, import the GitHub repo. Framework preset: *Other* (the repo's `vercel.json` sets the build).
4. **Environment variables** (Project → Settings → Environment Variables, for Production and Preview):

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SITE_URL` | the site's `https://` address |
   | `FIREBASE_PROJECT_ID` | `goldenstay-b847e` |
   | `FIREBASE_SERVICE_ACCOUNT` | the whole service-account JSON on one line (secret) |
   | `VITE_FIREBASE_*` (6 values) | from Firebase → Project settings → Your apps (public; needed at build time) |
   | `ADMIN_EMAILS` | `goldenstay2026@gmail.com` |
   | `ADMIN_PASSWORD_HASH` | backup admin password (optional, secret) |
   | `OWNER_LINK_SECRET` | 32+ random characters (secret) |
   | `SHEETS_WEBHOOK_URL`, `SHEETS_SECRET` | Apps Script URL + shared secret (secret) |
   | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | optional |

5. **Deploy**, then in Firebase → Authentication → Settings → *Authorized domains* add the Vercel domain (and your own domain).
6. Check: the Book page shows a price for chosen dates, `/admin/` lets the owner sign in.

On Vercel there is no always-on timer: unpaid holds are released whenever availability is next checked, owner emails and Sheet rows are sent before the function finishes (`waitUntil`), and the admin refreshes by checking for changes every 10 seconds.

**Self-hosting instead** (any Node host): set the same variables (or `FIREBASE_SERVICE_ACCOUNT_FILE` = path to the JSON), then `npm ci && npm run build && npm start` behind HTTPS with `TRUST_PROXY=true`.

Admin: `https://your-domain/admin/` (owner signs in with Firebase; `ADMIN_EMAILS`). `/admin/`, `/booking/`, `/account/` and `/confirm/` are `noindex`.

## Firestore usage and backups

Free plan (Spark) daily allowance: 50,000 reads, 20,000 writes, 1 GiB. A calendar month view reads only the nights that are booked; the public availability answers are cached at Vercel's edge for 10 seconds; the admin's change check is 2 reads and pauses while its tab is hidden. If a day's allowance runs out, Firestore stops answering until the next day (nothing is charged on the free plan).

Backups: Admin → Bookings → *All* → **CSV** (monthly), plus the Google Sheet's *Bookings* tab. For full database backups, Firestore's export (Google Cloud console) needs the paid Blaze plan.

## How booking & payment works

1. Guest picks room + dates on `/book/`. The **server** prices it from the `rooms` table (price × nights; owner policy: published prices are final, no taxes or fees added, full amount paid online). Anything the browser sends as an amount is ignored.
2. Submitting creates a **pending booking** with an ID like `GS7K3F9Q` and **holds the room** (`BOOKING_HOLD_MINUTES`, default 30). Each held night is one Firestore document `booking_nights/{unit}_{night}` (e.g. `ac_2026-11-22`), created inside a transaction that fails if it already exists — so two bookings can never take the same night, even under simultaneous requests (tested with 8 at once). The 2BHK and the Entire Homestay hold both physical rooms.
3. The guest lands on `/booking/?ref=…&t=…` (private link) and pays by one of:

### Method A — PhonePe Payment Gateway (off until credentials are issued)

- "Pay Now with PhonePe" → server creates a PhonePe Standard Checkout v2 order (`/checkout/v2/pay`) for the booking's stored amount → guest is redirected to PhonePe's hosted page.
- The booking is confirmed **only** when PhonePe's **Order Status API** says `COMPLETED` for the exact amount. Triggers: the authenticated webhook, the guest's return to the site, an admin "Check with PhonePe", or the background sweep (every minute) for missed webhooks. Webhook bodies are never trusted on their own.
- Duplicate webhooks, double-clicks, failed/pending payments, payments that arrive after the hold expired, duplicate payments and amount mismatches are all handled (see `server/test/gateway.test.ts`). Anything needing a human is flagged "Needs action" in the admin.
- Refunds go through PhonePe's refund API from the admin.

### Method B — the existing PhonePe merchant QR (live now)

- Shows the owner's original QR image **unmodified** (`public/images/phonepe-merchant-qr.jpg`, excluded from image processing), the exact amount, the UPI ID `Q089453569@ybl` with copy buttons, and steps.
- The QR is static (`upi://pay?pa=Q089453569@ybl&pn=PhonePeMerchant&mc=0000&mode=02` — **no amount**), so the guest types the amount, then submits the **12-digit UTR**.
- The booking becomes **Pending Verification** — never auto-confirmed. The owner checks the UTR and amount in the PhonePe Business app, then **Verifies** (confirms the booking) or **Rejects** (cancels, frees the room) in the admin. A UTR can't be reused across bookings.

## Admin (`/admin/`)

- **Bookings**: filters (Needs action, Awaiting payment, Pending verification, Confirmed, …), search, and a detail panel with guest info, stay, amounts, every payment attempt (UTR / PhonePe order + transaction IDs), refunds and full history.
- Actions: verify / reject QR payment, check status with PhonePe, refund (gateway via API; QR recorded after refunding in the PhonePe Business app), cancel booking, mark an issue resolved.
- **Rooms & prices**: change nightly price or turn online booking off per room. Existing bookings keep their booked price.
- **Audit log**: every guest, system, PhonePe and admin action. All admin actions require a note.

## Turning on the PhonePe gateway

1. Get PhonePe PG access (PhonePe Business → Payment Gateway). In the dashboard's Developer Settings note the **Client ID, Client Secret, Client Version**.
2. Configure the webhook URL `https://your-domain/api/webhooks/phonepe` with a username + password; put the same values in `.env`.
3. Set `PHONEPE_ENABLED=true`, `PHONEPE_ENV=sandbox`, restart, and run the UAT flow with PhonePe's sandbox (success, failure, pending).
   - **Confirm the webhook header format** with a real sandbox webhook: PhonePe documents `Authorization: SHA256(username:password)` but not the encoding. The server accepts the hex digest (see `verifyWebhookAuth` in `server/phonepe.ts`); adjust there if PhonePe sends something else. Rejected webhooks are logged in the `webhook_events` Firestore collection.
4. Switch to `PHONEPE_ENV=production` with production credentials.

Secrets live only in the server's `.env`; the browser bundle contains no credentials (checked on every build review — `grep -r PHONEPE_ dist` returns nothing).

## Where things live

| What | Where |
| --- | --- |
| Website copy, photos, links, couples / entire-homestay flags, policy values | `src/data/site.ts` |
| Policy page wording (Terms, Privacy, Cancellation, House Rules) | `src/data/policies.ts` |
| Tabs (hash routing: #home, #rooms … #house-rules) | `src/lib/router.tsx`, `src/App.tsx`, `src/components/Nav.tsx` |
| Room catalogue (seed prices, physical units) | `shared/catalog.ts` |
| Validation shared by site + server | `shared/validate.ts` |
| Server: API routes / bookings / payments / PhonePe client / admin auth | `server/app.ts`, `server/bookings.ts`, `server/payments.ts`, `server/phonepe.ts`, `server/auth.ts` |
| Database schema | `server/db.ts` |
| Checkout, booking status, account, admin pages | `src/book/`, `src/booking/`, `src/account/`, `src/admin/` |
| Guest sign-in (Firebase Auth) + profile (Firestore) | `src/lib/firebase.ts`, `src/lib/auth.tsx`, `src/components/AuthPanel.tsx`, `server/firebase.ts`, `firestore.rules` |
| Enquiry form → Telegram + Google Sheets | `src/components/EnquiryForm.tsx`, `server/enquiry.ts`, `server/notify/`, `scripts/google-apps-script.gs` |
| WhatsApp enquiry template (fallback) | `src/lib/enquiry.ts` |
| Design tokens | `src/index.css` (`@theme`) |

## Before launch: confirm with the owner

**Policy values** (`policies` in `src/data/site.ts`). Each is `null` today, so the sentence or bullet that needs it is hidden on the Terms, Cancellation and House Rules pages. Fill one in and it appears:

- [ ] `checkInTime` (e.g. "12:00 PM") and `checkOutTime` (e.g. "11:00 AM")
- [ ] `advanceRequired` (e.g. "50% of the first night's tariff")
- [ ] `freeCancellationHours`, `lateCancellationCharge`, `refundDays`. While all three are null, the Cancellation page shows only the general clauses plus "contact us on WhatsApp"
- [ ] `smoking`, `alcohol`, `pets`, `visitors`, `quietHours`
- [ ] `securityDeposit`, `eventDeposit`
- [ ] Update `lastUpdated` whenever a policy changes. If analytics or tracking are ever added, update the Privacy page's "Cookies" clause first (`src/data/policies.ts`).

**Other items:**

- [ ] PhonePe Payment Gateway credentials (until then: QR payments only)
- [ ] Cancellation / refund policy text to show guests
- [ ] Check-in / check-out times, ID requirement, house rules
- [ ] Whether GST or any fee applies (currently none added — prices are final)
- [ ] Amenity list: confirm all pills; add Wi-Fi, parking, hot water etc. only if true
- [ ] Exterior / entrance photo
- [ ] Typical WhatsApp reply time
- [ ] Google Maps embed URL → `business.mapEmbedUrl`
- [ ] Direct Google "write a review" link → `business.reviewUrl`
- [ ] Distances to the four landmarks, measured from the property pin
- [ ] Licensed photos for Kamakhya, Museum, Umananda, Riverfront (line art until then)
- [ ] Permission to quote any real guest reviews
