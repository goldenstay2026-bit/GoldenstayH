# Enquiry & booking notifications — setup guide

When a guest sends the enquiry form on the website, two things happen:

1. **You get a Telegram message instantly**: name, phone, dates, guests, room and message.
2. **A new row is added to a Google Sheet**, so you have a log of every enquiry.

You also get:

- **A Telegram alert when a guest pays by QR** and submits their payment reference, so you can verify it in the admin.
- **A "Payment to verify" email to goldenstay2026@gmail.com when a guest taps "I've paid"**, with the amount, UPI reference (if given), guest and stay, and a **Review & confirm booking** button. It opens a page with **Confirm** / **Reject**, with no admin login needed. The link works for 7 days and only for that payment. Check your PhonePe Business app before confirming: a plain UPI ID can't tell the website that money arrived. The button points to `SITE_URL`, so set that to your real `https://` domain when you go live (it's `http://localhost:5173` for local testing).
- **An email to goldenstay2026@gmail.com when a booking is confirmed**, i.e. after the payment is verified (automatically for PhonePe online payments, or when you press *Verify* for a QR payment). The email has the booking ID, guest, phone, email, room, dates, amount paid and the payment reference.
- **Every online booking in a "Bookings" tab** of the same Google Sheet: one row per booking that updates itself as its status changes (*Awaiting payment → Pending verification → Confirmed*, or *Cancelled / Expired*), with the payment status, amount paid and payment reference.

This takes about 20 minutes, once. You need a phone with Telegram and a Google account.

---

## 1. Create your Telegram bot and copy its token

1. Open Telegram and search for **@BotFather** (it has a blue tick).
2. Tap **Start**, then send: `/newbot`
3. BotFather asks for a **name**. Send something like: `Golden Stay Enquiries`
4. Then it asks for a **username**, which must end in `bot`. For example: `goldenstay_enquiries_bot`
5. BotFather replies with a **token** that looks like `7012345678:AAH3kd9...`.
   **Copy it and keep it private.** Anyone with this token can send messages as your bot.

This is your `TELEGRAM_BOT_TOKEN`.

## 2. Get your chat ID

1. In Telegram, search for your new bot's username, open it and tap **Start** (or send "hi").
   *The bot can only message you after you have messaged it first.*
2. On a computer, open this address in your browser. Put your token after `bot`, with no spaces:
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   Example: `https://api.telegram.org/bot7012345678:AAH3kd9.../getUpdates`
3. You'll see some text. Find `"chat":{"id":` followed by a number, for example `"chat":{"id":512345678,`.
   That number is your `TELEGRAM_CHAT_ID`.
   - If you only see `{"ok":true,"result":[]}`, send the bot another message and refresh the page.
   - For a **group** (e.g. owner + staff): add the bot to the group, send a message in the group, then refresh. Group IDs start with a minus sign, like `-1001234567890`. Copy the minus too.

## 3. Create the Google Sheet and the Apps Script

1. **Sign in to Google as goldenstay2026@gmail.com** (confirmation emails are sent from the account that owns the script). Go to [sheets.google.com](https://sheets.google.com) and create a blank spreadsheet. Name it e.g. **Golden Stay – Booking log**.
2. In the menu choose **Extensions → Apps Script**. A code editor opens in a new tab.
3. Delete everything in the editor. Open the file `scripts/google-apps-script.gs` from this project, copy **all** of it, and paste it in.
4. Click the **Save** icon (💾).
5. Make up a long secret password: 30 or more random letters and numbers, with no spaces. Your developer can generate one with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. This is your `SHEETS_SECRET`.
6. On the left, click the **gear icon (Project Settings)** → scroll to **Script properties** → **Add script property**:
   - Property: `SHEETS_SECRET`
   - Value: the secret from step 5
   - Click **Save script properties**.
7. **Allow the script to send email (one time):** at the top of the editor, choose the function **sendTestEmail** in the dropdown next to ▶ Run, then click **Run**.
   - Google asks you to **Review permissions**. Choose your account. If you see "Google hasn't verified this app", click **Advanced → Go to (project name) (unsafe)** → **Allow**. That's normal for your own script.
   - A test email "Golden Stay – test email" arrives at goldenstay2026@gmail.com.
8. Click **Deploy** (top right) → **New deployment**.
   - Click the gear next to "Select type" → choose **Web app**.
   - Description: `Enquiry log + booking emails`
   - **Execute as: Me**
   - **Who has access: Anyone** (the secret password stops strangers from adding rows)
   - Click **Deploy**.
9. If Google asks to **Authorize access** again, allow it the same way.
10. Copy the **Web app URL**. It ends in `/exec`. This is your `SHEETS_WEBHOOK_URL`.
11. To check it: open that URL in your browser. You should see `{"ok":true,"service":"Golden Stay enquiry log"}`.

The **Enquiries** tab (Timestamp (IST), Name, Phone, Check-in, Check-out, Nights, Guests, Room, Message, Status) and the **Bookings** tab (Booking ID, Status, Payment, Guest, Phone, Email, Room, Check-in, Check-out, Nights, Guests, Total, Paid, Method, Reference, Booked at, Last update, Needs attention, Guest message) are created automatically the first time they're needed. Every new enquiry has Status **New**. You can change it yourself to *Called*, *Booked*, etc.

In **Bookings**, don't edit the website's columns: they're overwritten whenever the booking changes. To keep your own notes, add columns to the **right** of the last column; the script never touches those. The booking's real status always lives in the admin (`/admin/`); the sheet is a copy for your records.

> ⚠️ **Keep the Sheet private.** It contains guests' names, phone numbers and emails. In the Sheet, click **Share** → under *General access* choose **Restricted**, so only people you add (e.g. you and your staff) can open it. Don't use "Anyone with the link". The website doesn't need the Sheet to be shared; it writes through the Apps Script.

The confirmation email always goes to **goldenstay2026@gmail.com**. That address is written in the script (`OWNER_EMAIL` at the top), so the website can't send email to anyone else. To change it, edit that line and redeploy.

> **Already set this up before and updating the script?** Paste the new code, **Save**, run **sendTestEmail** once (step 7), then Deploy → **Manage deployments** → ✏️ edit → Version: **New version** → Deploy. The URL stays the same.

## 4. Add the settings to the server and restart

The four values are **secrets**. They go only in the server's `.env` file (or your hosting provider's "Environment variables" screen), never in website code:

```
TELEGRAM_BOT_TOKEN=7012345678:AAH3kd9...
TELEGRAM_CHAT_ID=512345678
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfy.../exec
SHEETS_SECRET=the-long-secret-from-step-3
```

- **On your own server / VPS:** edit the `.env` file in the project folder, then restart the app (`npm start`, or restart the service).
- **On Railway / Render:** open the project → **Variables / Environment** → add the four keys → **Redeploy**.

Never put these in a variable starting with `VITE_`. Those are bundled into the public website.

## 5. Test it

**On the website:** open the site, scroll to **Send us your dates**, fill in the form and press **Send Enquiry**. Within a few seconds:

- Telegram shows **🏠 New Enquiry – Golden Stay** with the details. Tap the phone number to call, or **💬 WhatsApp guest**.
- The Google Sheet shows a new row in the **Enquiries** tab.

**From a computer (sends a sample enquiry):**

```bash
node scripts/send-test-enquiry.mjs https://www.goldenstay.space
```

or with curl:

```bash
curl -X POST https://www.goldenstay.space/api/enquiry \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Guest","phone":"+91 98765 43210","checkIn":"2026-12-20","checkOut":"2026-12-22","guests":2,"room":"ac-1bhk","message":"Test","website":""}'
```

(Use check-in / check-out dates in the future.) A working setup answers `{"ok":true}`.

**Booking confirmation email:** make a test booking on `/book/`, pay by QR with any 12-digit reference, then in `/admin/` open it and press **Verify payment**. Within a few seconds an email "✅ Booking confirmed – GS…" arrives at goldenstay2026@gmail.com, and the booking's row in **Bookings** changes to *Confirmed / Paid*. The row first appears as soon as the booking is made (*Awaiting payment*). Cancel the test booking in the admin afterwards; the row then shows *Cancelled*.

### Troubleshooting

| What you see | What to do |
| --- | --- |
| No Telegram message | Check the token and chat ID. Make sure you pressed **Start** in the bot. The server log shows `[enquiry] Telegram failed: …` with Telegram's reason (e.g. "chat not found"). |
| No confirmation email | Check that you ran **sendTestEmail** once and allowed it, and redeployed as a **New version** after pasting the new script. In the admin, open the booking: its History shows `email.confirmation_sent` or `email.confirmation_failed` with the reason. A failed email is retried once after 30 seconds; the booking stays confirmed either way. Gmail allows about 100 such emails per day on a free account. |
| Bookings tab not updating | Make sure you pasted the **latest** `scripts/google-apps-script.gs` and redeployed as a **New version**. The server log shows `[sheets] booking GS… sync … failed: …` with the reason; it retries once after 30 seconds. |
| No new sheet row | Open the web app URL in a browser: it must show `{"ok":true,...}`. If you see a Google sign-in page, redeploy with **Who has access: Anyone**. If the log says `unauthorized`, the `SHEETS_SECRET` in `.env` and in Script properties don't match exactly. |
| Guest sees "Enquiry not sent" | Both Telegram **and** Sheets failed. The guest is offered a WhatsApp button with their details filled in, so the enquiry isn't lost. Fix the settings above. |
| "Too many attempts" | Spam protection allows 5 enquiries per 10 minutes from one connection. Wait and try again. |

---

## For developers

- Endpoint: `POST /api/enquiry` (JSON), served by the Express server (`server/enquiry.ts`). Responses: `405` wrong method, `400` invalid input (`{ error, field }`), `429` rate limited, `500` when both channels fail, `200 { ok: true }` otherwise.
- Validation is mirrored in the browser (`src/lib/enquiry.ts`) and enforced on the server; strings are trimmed and length-capped, and all user text is HTML-escaped for Telegram.
- Spam: hidden honeypot field `website` (a filled field gets a silent `200` and nothing is sent) plus an in-memory per-IP limit of 5 per 10 minutes. Behind a proxy, set `TRUST_PROXY=true` so the limit sees real IPs.
- Telegram and Sheets run with `Promise.allSettled`; failures are logged server-side. If Telegram rejects the `tel:` phone link, the message is resent with the number as plain text, which Telegram makes tappable itself.
- **Local testing:** put the four variables in `.env`, run `npm run dev` (API on :8787, site on http://localhost:5173), then submit the form or run `node scripts/send-test-enquiry.mjs`. Automated tests use fake Telegram/Sheets servers: `npm test`.
