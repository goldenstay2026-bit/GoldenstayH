import { business } from '../data/site';
import { SectionHead } from './Heading';
import { InstagramIcon } from './icons';

// Honest empty state. Add real reviews only with the guest's permission,
// and show name, source and month. No stars, counts or rating schema.
export function Reviews() {
  const card = 'flex min-h-[150px] flex-col justify-between gap-6 rounded-[22px] bg-card p-5 md:min-h-[156px]';
  return (
    <section aria-labelledby="reviews-title" className="section container-x">
      <SectionHead
        id="reviews-title"
        before="What"
        accent="guests"
        after="say"
        lead="Genuine reviews will appear here once guests share them, with their permission."
      />
      <ul className="grid gap-[14px] md:grid-cols-3">
        <li className={card}>
          <p className="text-[15px] leading-[1.5]">We look forward to welcoming you to Golden Stay.</p>
          <p className="text-[12px] text-muted">— The Golden Stay team</p>
        </li>
        <li className={card}>
          <p className="text-[15px] leading-[1.5]">Stayed with us? We’d love to hear about it.</p>
          <a
            href={business.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="link-underline w-fit text-[13px] font-semibold"
          >
            Leave a review on Google
          </a>
        </li>
        <li className={card}>
          <p className="text-[15px] leading-[1.5]">See more of the rooms and updates from Golden Stay.</p>
          <a
            href={business.instagram.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-fit items-center gap-1.5 text-[13px] font-semibold"
          >
            <InstagramIcon size={14} />
            <span className="link-underline">{business.instagram.handle} on Instagram</span>
          </a>
        </li>
      </ul>
    </section>
  );
}
