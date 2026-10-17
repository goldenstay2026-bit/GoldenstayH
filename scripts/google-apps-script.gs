/**
 * Golden Stay — enquiry log + booking-confirmation email (Google Apps Script web app)
 *
 * Receives JSON from the website's server and:
 *   • action "enquiry"            → appends a row to the "Enquiries" sheet
 *   • action "booking_upsert"     → adds/updates the booking's row in the "Bookings" sheet
 *                                   (one row per booking, kept up to date as its status changes)
 *   • action "booking_confirmed"  → emails OWNER_EMAIL that a booking is confirmed
 *
 * Setup (step by step in NOTIFICATIONS_SETUP.md):
 *   1. In the Google Sheet: Extensions → Apps Script, paste this whole file, Save.
 *   2. Project Settings (gear) → Script properties → add SHEETS_SECRET
 *      (same long random text as SHEETS_SECRET in the server's .env).
 *   3. Choose the function "sendTestEmail" at the top and click Run once — Google asks you to
 *      allow the script to send email as you. A test email arrives at OWNER_EMAIL.
 *   4. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone.
 *      Copy the Web app URL (ends in /exec) into SHEETS_WEBHOOK_URL in the server's .env.
 *      (Already deployed before? Deploy → Manage deployments → edit → Version: New version.)
 *
 * Emails are sent from the Google account that owns this script, and ONLY to
 * OWNER_EMAIL — the website can't make it email anyone else.
 */

var OWNER_EMAIL = 'goldenstay2026@gmail.com';
var TIMEZONE = 'Asia/Kolkata';

var ENQUIRY_SHEET = 'Enquiries';
var ENQUIRY_HEADERS = ['Timestamp (IST)', 'Name', 'Phone', 'Check-in', 'Check-out', 'Nights', 'Guests', 'Room', 'Message', 'Status'];

var BOOKINGS_SHEET = 'Bookings';
// The script only ever writes these columns. Add your own columns (notes, room key…)
// to the RIGHT of "Sync version" and they'll never be overwritten.
var BOOKING_HEADERS = ['Booking ID', 'Status', 'Payment', 'Guest', 'Phone', 'Email', 'Room', 'Check-in', 'Check-out', 'Nights', 'Guests', 'Total', 'Paid', 'Method', 'Reference', 'Booked at (IST)', 'Last update (IST)', 'Needs attention', 'Guest message', 'Sync version'];

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var expected = PropertiesService.getScriptProperties().getProperty('SHEETS_SECRET');
    if (!expected) return json_({ ok: false, error: 'SHEETS_SECRET script property is not set' });
    if (!safeEqual_(String(body.secret || ''), expected)) return json_({ ok: false, error: 'unauthorized' });

    var action = body.action || 'enquiry';
    if (action === 'enquiry') return json_(logEnquiry_(body));
    if (action === 'booking_upsert') return json_(upsertBooking_(body.booking || {}));
    if (action === 'booking_confirmed') return json_(bookingConfirmed_(body));
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Opening the web app URL in a browser shows this — handy to check the deployment works. */
function doGet() {
  return json_({ ok: true, service: 'Golden Stay enquiry log' });
}

function logEnquiry_(b) {
  return withLock_(function () {
    var sheet = getSheet_(ENQUIRY_SHEET, ENQUIRY_HEADERS);
    sheet.appendRow([
      now_(),
      text_(b.name, 80),
      text_(b.phone, 20),
      text_(b.checkIn, 10),
      text_(b.checkOut, 10),
      number_(b.nights),
      number_(b.guests),
      text_(b.room, 80),
      text_(b.message, 1000),
      'New',
    ]);
    return { ok: true, row: sheet.getLastRow() };
  });
}

/** One row per booking: update it if the Booking ID exists, otherwise add it. */
function upsertBooking_(k) {
  if (!k.ref) return { ok: false, error: 'missing booking id' };
  var version = 'v' + String(k.version || ''); // "v" prefix keeps Sheets from turning it into a date
  var values = [
    text_(k.ref, 20),
    text_(k.status, 40),
    text_(k.payment, 40),
    text_(k.guestName, 80),
    text_(k.guestPhone, 20),
    text_(k.guestEmail, 254),
    text_(k.room, 80),
    text_(k.checkIn, 10),
    text_(k.checkOut, 10),
    number_(k.nights),
    number_(k.guests),
    text_(k.total, 20),
    text_(k.paid, 20),
    text_(k.method, 60),
    text_(k.reference, 80),
    text_(k.bookedAt, 40),
    text_(k.updatedAt, 40),
    text_(k.needsAttention, 300),
    text_(k.message, 500),
    version,
  ];
  return withLock_(function () {
    var sheet = getSheet_(BOOKINGS_SHEET, BOOKING_HEADERS);
    var row = findRow_(sheet, String(k.ref));
    if (row) {
      // Ignore an update that is older than what's already in the sheet.
      var current = String(sheet.getRange(row, BOOKING_HEADERS.length).getValue());
      if (current && current > version) return { ok: true, row: row, skipped: 'older update' };
      sheet.getRange(row, 1, 1, values.length).setValues([values]);
      return { ok: true, row: row, updated: true };
    }
    sheet.appendRow(values);
    return { ok: true, row: sheet.getLastRow(), created: true };
  });
}

/** Row number whose column A equals the booking ID, or 0. */
function findRow_(sheet, ref) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var hit = sheet.getRange(2, 1, last - 1, 1).createTextFinder(ref).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function bookingConfirmed_(b) {
  // The server builds the message (all guest input already HTML-escaped); we only deliver it to the owner.
  MailApp.sendEmail({
    to: OWNER_EMAIL,
    subject: String(b.subject || 'Booking confirmed').slice(0, 250),
    body: String(b.text || '').slice(0, 20000),
    htmlBody: String(b.html || '').slice(0, 50000),
    name: 'Golden Stay website',
  });
  return { ok: true };
}

/** Run from the editor: the Execution log shows which spreadsheet this script writes to. */
function showSpreadsheetUrl() {
  Logger.log(SpreadsheetApp.getActiveSpreadsheet().getUrl());
}

/** Run this once from the editor to grant email permission and check delivery. */
function sendTestEmail() {
  MailApp.sendEmail(OWNER_EMAIL, 'Golden Stay – test email', 'Booking confirmation emails from the website will arrive like this.');
}

// ---------- helpers ----------

function withLock_(fn) {
  // Serialise writes so two requests arriving together can't collide.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Returns the named sheet, creating it and its bold, frozen header row if needed. */
function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (first.join('') === '') {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // The sync-version column is bookkeeping for the script; keep it out of the way.
    if (headers[headers.length - 1] === 'Sync version') sheet.hideColumns(headers.length);
  }
  return sheet;
}

function now_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'dd MMM yyyy, hh:mm a');
}

/**
 * Plain text for a cell. Values starting with = + - @ are prefixed with an
 * apostrophe so Sheets shows them as text instead of running them as a
 * formula (e.g. "+91 98765 43210", or a malicious "=IMPORTXML(...)").
 */
function text_(v, max) {
  var s = String(v == null ? '' : v).slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function number_(v) {
  var n = Number(v);
  return isFinite(n) ? n : '';
}

/** Compares secrets without stopping at the first different character. */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
