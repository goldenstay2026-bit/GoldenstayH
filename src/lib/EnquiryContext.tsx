import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_GUESTS } from '../data/site';
import type { EnquiryValues } from './enquiry';
import { useRouter } from './router';

export const ENQUIRY_FORM_ID = 'enquiry';
export const ENQUIRY_FIRST_FIELD_ID = 'enq-name';

const initial: EnquiryValues = {
  bookingType: 'room',
  name: '',
  phone: '',
  checkIn: '',
  checkOut: '',
  guests: String(DEFAULT_GUESTS),
  room: '',
  occasion: '',
  message: '',
};

type Ctx = {
  values: EnquiryValues;
  setValues: React.Dispatch<React.SetStateAction<EnquiryValues>>;
  /** Merge values into the enquiry form, switch to the Contact tab and focus the form. */
  prefill: (partial: Partial<EnquiryValues>) => void;
};

const EnquiryContext = createContext<Ctx | null>(null);

export function EnquiryProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<EnquiryValues>(initial);

  const { navigate } = useRouter();
  const prefill = useCallback(
    (partial: Partial<EnquiryValues>) => {
      setValues((v) => ({ ...v, ...partial }));
      // Switch to the Contact tab, bring the form into view and focus its first field.
      navigate('contact', () => {
        document.getElementById(ENQUIRY_FORM_ID)?.scrollIntoView({ block: 'start' });
        document.getElementById(ENQUIRY_FIRST_FIELD_ID)?.focus({ preventScroll: true });
      });
    },
    [navigate],
  );

  const value = useMemo(() => ({ values, setValues, prefill }), [values, prefill]);
  return <EnquiryContext.Provider value={value}>{children}</EnquiryContext.Provider>;
}

export function useEnquiry() {
  const ctx = useContext(EnquiryContext);
  if (!ctx) throw new Error('useEnquiry must be used inside <EnquiryProvider>');
  return ctx;
}
