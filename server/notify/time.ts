const istFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "15 Oct 2026, 4:05 pm IST" */
export const formatIST = (d: Date) => `${istFormat.format(d)} IST`;
