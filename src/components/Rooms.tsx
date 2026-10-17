import { useEffect, useState } from 'react';
import { CalendarDays, CircleCheck, CircleX } from 'lucide-react';
import { formatISODate } from '../../shared/validate.ts';
import { entireHomestay, formatINR, groupBooking, rooms, type Room } from '../data/site';
import { optionsAvailability } from '../lib/availability';
import { useEnquiry } from '../lib/EnquiryContext';
import { useLiveRooms } from '../lib/useLiveRooms';
import { useToday } from '../lib/useToday';
import { DateRangeField } from './DateRangeField';
import { CoupleNote } from './CoupleNote';
import { SectionHead } from './Heading';
import { Img } from './Img';

type Stay = { checkIn: string; checkOut: string };

/** "Available for your dates" / "Booked for these dates" — only once dates are chosen. */
function AvailabilityPill({ available }: { available: boolean | undefined }) {
  if (available === undefined) return null;
  return available ? (
    <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#e7f1e9] px-2.5 py-1 text-[12px] font-semibold text-[#24603a]">
      <CircleCheck size={13} aria-hidden="true" /> Available for your dates
    </span>
  ) : (
    <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#ece9e4] px-2.5 py-1 text-[12px] font-semibold text-ink/80">
      <CircleX size={13} aria-hidden="true" /> Booked for these dates
    </span>
  );
}

export function RoomCard({
  room,
  livePrice,
  bookable = true,
  stay,
  available,
  onTryOtherDates,
}: {
  room: Room;
  livePrice?: number;
  bookable?: boolean;
  stay?: Stay | null;
  available?: boolean;
  onTryOtherDates?: () => void;
}) {
  const { prefill } = useEnquiry();
  const price = livePrice ?? room.price;
  const enquire = () => prefill({ bookingType: 'room', room: room.id, ...(stay ?? {}) });
  const titleId = `room-${room.id}-title`;
  const taken = available === false;
  const bookQuery = new URLSearchParams({ room: room.id, ...(stay ? { in: stay.checkIn, out: stay.checkOut } : {}) }).toString();

  return (
    <article aria-labelledby={titleId} className="flex flex-col rounded-[22px] bg-card p-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-beige">
        <Img
          name={room.image}
          alt={room.alt}
          sizes="(min-width: 1101px) 25vw, (min-width: 641px) 50vw, 100vw"
          className="size-full object-cover"
        />
        <span className="chip absolute left-2.5 top-2.5">{room.badge}</span>
      </div>
      <div className="flex flex-1 flex-col px-2.5 pb-2 pt-4">
        <h3 id={titleId} className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">
          {room.name}
        </h3>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-muted">{room.description}</p>
        <AvailabilityPill available={available} />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-5">
          {price === null ? (
            <>
              <p className="text-[15px] font-semibold">Contact for price</p>
              <button type="button" onClick={enquire} className="btn btn-dark h-9 px-4 text-[13px]">
                Ask for Price
                <span className="sr-only"> — {room.name}</span>
              </button>
            </>
          ) : (
            <>
              <p className="whitespace-nowrap">
                <span className="text-[22px] font-bold tabular-nums tracking-[-0.02em]">{formatINR(price)}</span>
                <span className="ml-1 text-[12px] text-muted">/ night</span>
              </p>
              <div className="flex gap-1.5">
                {taken ? (
                  <button type="button" onClick={onTryOtherDates} className="btn btn-outline h-9 px-3.5 text-[13px]">
                    Try other dates
                    <span className="sr-only"> for {room.name}</span>
                  </button>
                ) : (
                  <button type="button" onClick={enquire} className="btn btn-outline h-9 px-3.5 text-[13px]">
                    Enquire
                    <span className="sr-only"> about {room.name} on WhatsApp</span>
                  </button>
                )}
                {bookable && !taken && (
                  <a href={`/book/?${bookQuery}`} className="btn btn-dark h-9 px-3.5 text-[13px]">
                    Book
                    <span className="sr-only"> {room.name} and pay online</span>
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** Whole-property card, same style as a RoomCard; always "Contact for price". */
function EntireHomestayCard({ stay, available, onTryOtherDates }: { stay?: Stay | null; available?: boolean; onTryOtherDates?: () => void }) {
  const { prefill } = useEnquiry();
  return (
    <article aria-labelledby="room-entire-title" className="flex flex-col rounded-[22px] bg-card p-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-beige">
        <Img
          name={entireHomestay.image}
          alt={entireHomestay.alt}
          sizes="(min-width: 1101px) 25vw, (min-width: 641px) 50vw, 100vw"
          className="size-full object-cover"
        />
        <span className="chip absolute left-2.5 top-2.5">{entireHomestay.badge}</span>
      </div>
      <div className="flex flex-1 flex-col px-2.5 pb-2 pt-4">
        <h3 id="room-entire-title" className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">
          {entireHomestay.name}
        </h3>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-muted">{entireHomestay.description}</p>
        <AvailabilityPill available={available} />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-5">
          <p className="text-[15px] font-semibold">Contact for price</p>
          {available === false ? (
            <button type="button" onClick={onTryOtherDates} className="btn btn-outline h-9 px-4 text-[13px]">
              Try other dates
              <span className="sr-only"> for the entire homestay</span>
            </button>
          ) : (
            <button type="button" onClick={() => prefill({ bookingType: 'entire', ...(stay ?? {}) })} className="btn btn-dark h-9 px-4 text-[13px]">
              Enquire
              <span className="sr-only"> about booking the entire homestay</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Rooms tab "Check availability": pick dates, then each card says if it's free. */
function useRoomAvailability() {
  const [stay, setStay] = useState<Stay>({ checkIn: '', checkOut: '' });
  const [result, setResult] = useState<Record<string, boolean> | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const complete = Boolean(stay.checkIn && stay.checkOut);
  useEffect(() => {
    setResult(null);
    if (!complete) return setState('idle');
    let live = true;
    setState('loading');
    optionsAvailability(stay.checkIn, stay.checkOut)
      .then((r) => live && (setResult(r), setState('idle')))
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [stay.checkIn, stay.checkOut, complete]);
  return { stay, setStay, result, state, complete };
}

function CheckAvailability({ a, openRef }: { a: ReturnType<typeof useRoomAvailability>; openRef: { current: (() => void) | null } }) {
  const today = useToday();
  return (
    <DateRangeField
      idIn="rooms-check-in"
      idOut="rooms-check-out"
      option="any"
      checkIn={a.stay.checkIn}
      checkOut={a.stay.checkOut}
      today={today}
      title="Check availability"
      onChange={(checkIn, checkOut) => a.setStay({ checkIn, checkOut })}
    >
      {(open, expanded) => {
        openRef.current = open;
        return (
          <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] bg-cream px-4 py-3">
            <button
              type="button"
              id="rooms-check-in"
              onClick={open}
              disabled={!today}
              aria-haspopup="dialog"
              aria-expanded={expanded}
              className="btn btn-outline h-11 gap-2 bg-white px-4 text-[13.5px]"
            >
              <CalendarDays size={16} aria-hidden="true" />
              {a.complete ? `${formatISODate(a.stay.checkIn)} → ${formatISODate(a.stay.checkOut)}` : 'Check availability'}
            </button>
            <p className="text-[12.5px] text-muted" aria-live="polite">
              {a.state === 'loading'
                ? 'Checking…'
                : a.state === 'error'
                  ? 'Couldn’t check right now — enquire and we’ll confirm.'
                  : a.complete
                    ? 'Availability is updated by the host. Final confirmation is always by WhatsApp or phone.'
                    : 'Choose dates to see which rooms are free.'}
            </p>
            {a.complete && (
              <button type="button" onClick={() => a.setStay({ checkIn: '', checkOut: '' })} className="text-[12.5px] font-semibold underline underline-offset-4">
                Clear
              </button>
            )}
          </div>
        );
      }}
    </DateRangeField>
  );
}

export function Rooms() {
  const live = useLiveRooms();
  const a = useRoomAvailability();
  const [openPicker] = useState<{ current: (() => void) | null }>(() => ({ current: null }));
  const tryOther = () => {
    document.getElementById('rooms-check-in')?.scrollIntoView({ block: 'center' });
    openPicker.current?.();
  };
  const stay = a.complete ? a.stay : null;
  return (
    <section aria-labelledby="rooms-title" className="section container-x">
      <SectionHead
        id="rooms-title"
        before="Pick your"
        accent="room"
        lead="Choose the stay that suits you. Book and pay online, or share your dates and we’ll confirm availability on WhatsApp."
      />
      <CoupleNote className="-mt-2 mb-5" />
      <CheckAvailability a={a} openRef={openPicker} />
      <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2 lg:grid-cols-4">
        {rooms.map((r) => (
          <RoomCard
            key={r.id}
            room={r}
            livePrice={live?.[r.id] ? live[r.id].pricePaise / 100 : undefined}
            bookable={live?.[r.id]?.bookable ?? true}
            stay={stay}
            available={a.result ? a.result[r.id] : undefined}
            onTryOtherDates={tryOther}
          />
        ))}
        {groupBooking.entireHomestay && <EntireHomestayCard stay={stay} available={a.result ? a.result.entire : undefined} onTryOtherDates={tryOther} />}
      </div>
      <p className="mt-5 text-[13px]">
        <a href="#house-rules" className="link-underline font-semibold">
          Check-in/out times and house rules →
        </a>
      </p>
    </section>
  );
}
