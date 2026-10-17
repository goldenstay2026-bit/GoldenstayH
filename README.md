# Golden Stay — website, bookings & payments

Homestay website for Golden Stay, Maligaon, Guwahati. Built by Webro Studios.

- **Website**: React + TypeScript + Vite + Tailwind CSS v4 (prerendered homepage).
- **Server**: Node.js + Express + SQLite (`node:sqlite`, no native build). Serves the site, the booking API, PhonePe webhooks and the admin.
- Guests can **send an enquiry** (form → instant Telegram message to the owner + a row in a Google Sheet; see **[NOTIFICATIONS_SETUP.md](NOTIFICATIONS_SETUP.md)**), use the WhatsApp/call buttons, or **book and pay online** by QR (`/book/`). Booking online requires a guest account (Firebase email + password) — see **[FIREBASE_SETUP.md](FIREBASE_SETUP.md)**; guests see their bookings at `/account/`.

## Commands

```bash
npm install
npm run dev          # API on :8787 + Vite on :5173 (open http://localhost:5173)
npm run dev:emulators # same, but against local Firebase emulators (no real accounts)
npm test             # 100 server tests (pricing, availability, gateway, QR, admin, enquiries, emails, sign-in, security)
npm run test:rules   # 9 Firestore security-rules tests (Firestore emulator, needs Java)
node scripts/send-test-enquiry.mjs   # send a sample enquiry to a running server
npm run build        # type-check, build all pages, prerender the homepage into dist/
npm start            # production server: serves dist/ + /api on PORT (default 8787)
npm run admin:hash   # create the admin password hash for .env
npm run images       # regenerate WebP 400/800/1600w from public/images/*
```

Requires **Node.js 22.13+** (built-in SQLite).

## Deploying

1. Copy `.env.example` to `.env` on the server and fill it in (`SITE_URL`, `ADMIN_PASSWORD_HASH`, …). `.env` is git-ignored — never commit it.
2. `npm ci && npm run build && npm start` behind HTTPS (nginx / Caddy, or a host such as Railway / Render).
3. The database is a single file (`DATABASE_PATH`, default `data/golden-stay.db`). Use a **persistent disk** and back the file up regularly (e.g. nightly copy of `data/`).
4. Set `TRUST_PROXY=true` when behind a reverse proxy so rate limits see real client IPs.

Admin: `https://your-domain/admin/` (password from `ADMIN_PASSWORD_HASH`). `/admin/` and `/booking/` pages are `noindex`.

## How booking & payment works

1. Guest picks room + dates on `/book/`. The **server** prices it from the `rooms` table (price × nights; owner policy: published prices are final, no taxes or fees added, full amount paid online). Anything the browser sends as an amount is ignored.
2. Submitting creates a **pending booking** with an ID like `GS7K3F9Q` and **holds the room** (`BOOKING_HOLD_MINUTES`, default 30). Holds are rows in `booking_nights` with a `UNIQUE(unit, night)` constraint, so two bookings can never take the same night — even under simultaneous requests. The 2BHK holds both physical rooms (it is the AC + Non-AC 1BHK together).
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
   - **Confirm the webhook header format** with a real sandbox webhook: PhonePe documents `Authorization: SHA256(username:password)` but not the encoding. The server accepts the hex digest (see `verifyWebhookAuth` in `server/phonepe.ts`); adjust there if PhonePe sends something else. Rejected webhooks are logged in the `webhook_events` table.
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
