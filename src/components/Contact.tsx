import { ContactPanel } from './ContactPanel';
import { EnquiryForm } from './EnquiryForm';

export function Contact() {
  return (
    <section aria-labelledby="contact-title" className="section container-x">
      <div className="grid gap-[14px] lg:grid-cols-[0.92fr_1fr] [&>*]:min-w-0">
        <ContactPanel />
        <EnquiryForm />
      </div>
    </section>
  );
}
