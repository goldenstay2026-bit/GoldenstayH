// Sends a sample enquiry to the server so you can check Telegram + Google Sheets.
//
//   node scripts/send-test-enquiry.mjs                          (local: http://localhost:8787)
//   node scripts/send-test-enquiry.mjs https://your-domain.com  (live site)

const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');

const day = (offset) => {
  const d = new Date(Date.now() + 330 * 60_000); // today in India
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const enquiry = {
  name: 'Test Guest (please ignore)',
  phone: '+91 98765 43210',
  checkIn: day(7),
  checkOut: day(9),
  guests: 2,
  room: 'ac-1bhk',
  message: 'This is a test enquiry sent by scripts/send-test-enquiry.mjs',
  website: '', // honeypot — must stay empty
};

const res = await fetch(`${base}/api/enquiry`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(enquiry),
});
const body = await res.text();
console.log(`POST ${base}/api/enquiry → ${res.status}`);
console.log(body);
console.log(
  res.ok
    ? '\n✅ Sent. Check the owner’s Telegram chat and the "Enquiries" sheet. If only one arrived, see the server log for the reason.'
    : '\n❌ Not delivered. See the server log for details.',
);
process.exit(res.ok ? 0 : 1);
