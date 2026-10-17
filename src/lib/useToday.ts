import { useEffect, useState } from 'react';
import { todayISO } from './enquiry';

/**
 * Today's date (yyyy-mm-dd) in the visitor's timezone. Empty during the
 * prerendered first paint so the build date never leaks into the HTML.
 */
export function useToday(): string {
  const [today, setToday] = useState('');
  useEffect(() => setToday(todayISO()), []);
  return today;
}
