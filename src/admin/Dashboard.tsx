// Dashboard: the owner's overview — today's numbers, revenue, occupancy,
// upcoming check-ins, recent bookings and what needs attention.

import { BedDouble, CalendarCheck, CircleX, Clock, IndianRupee, Inbox } from 'lucide-react';
import { formatPaise, UNIT_ROOM_NAME } from '../../shared/catalog.ts';
import { Alert, BookingChip, Chip, Spinner } from '../components/ui';
import { PAYMENT_LABEL, formatISODate, monthTitle, nightsLabel, when, type AdminNotification, type BookingSummary, type DashboardData } from './lib';

type Go = 'bookings' | 'requests' | 'calendar';

export function DashboardView({ data, error, onOpenBooking, onGo }: { data: DashboardData | null; error: string; onOpenBooking: (ref: string) => void; onGo: (tab: Go) => void }) {
  if (error) return <Alert tone="danger" role="alert">{error}</Alert>;
  if (!data)
    return (
      <p className="flex justify-center gap-2 py-24 text-muted" role="status">
        <Spinner /> Loading the dashboard…
      </p>
    );
  const c = data.counts;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-bold">Dashboard</h1>
        <p className="text-[15px] text-muted">{formatISODate(data.today)}</p>
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" aria-label="Key figures">
        <Stat icon={BedDouble} label="Total bookings" value={c.totalBookings} onClick={() => onGo('bookings')} />
        <Stat icon={Inbox} label="Pending requests" value={c.pendingRequests} tone={c.pendingRequests ? 'warn' : undefined} onClick={() => onGo('requests')} />
        <Stat icon={CalendarCheck} label="Confirmed" value={c.confirmed} hint={c.completed ? `${c.completed} completed` : undefined} onClick={() => onGo('bookings')} />
        <Stat icon={CircleX} label="Cancelled / rejected" value={c.cancelled} onClick={() => onGo('bookings')} />
        <Stat icon={IndianRupee} label="Revenue received" value={formatPaise(data.revenue.totalPaise)} hint={`${formatPaise(data.revenue.thisMonthPaise)} this month`} />
        <Stat icon={Clock} label="Check-ins, next 7 days" value={c.upcomingCheckins} hint={c.awaitingPayment ? `${c.awaitingPayment} awaiting payment` : undefined} onClick={() => onGo('calendar')} />
      </ul>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Revenue by month" note="Payments received, minus refunds">
          <div className="hidden md:block">
            <RevenueChart data={data.revenue.byMonth} />
          </div>
          {/* Phones: the last 6 months, larger labels */}
          <div className="md:hidden">
            <RevenueChart data={data.revenue.byMonth.slice(-6)} width={360} />
          </div>
        </Card>
        <Card title="Needs your attention">
          <Notifications items={data.notifications} onOpenBooking={onOpenBooking} onGo={onGo} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Upcoming check-ins" note="Next 14 days">
          <BookingList items={data.upcoming} empty="No check-ins in the next two weeks." onOpen={onOpenBooking} showDate="checkIn" />
        </Card>
        <Card title="Recent bookings">
          <BookingList items={data.recent} empty="No bookings yet." onOpen={onOpenBooking} showDate="created" />
        </Card>
        <Card title="Occupancy" note="Nights booked per room">
          <Occupancy data={data.occupancy} />
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, tone, onClick }: { icon: typeof Inbox; label: string; value: number | string; hint?: string; tone?: 'warn'; onClick?: () => void }) {
  const body = (
    <>
      <span className={`grid size-9 place-items-center rounded-full ${tone === 'warn' ? 'bg-[#fbf0dc] text-[#7a4f00]' : 'bg-card text-ink'}`}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="mt-3 block min-h-[2.6em] text-[13px] font-semibold leading-[1.3] text-muted">{label}</span>
      <span className="mt-0.5 block text-[24px] font-bold tabular-nums leading-tight">{value}</span>
      {hint && <span className="mt-0.5 block text-[12.5px] text-muted">{hint}</span>}
    </>
  );
  return (
    <li className="min-w-0">
      {onClick ? (
        <button onClick={onClick} className="h-full w-full rounded-[18px] border border-hairline bg-white p-4 text-left shadow-[0_1px_2px_rgba(23,23,23,0.04)] hover:border-ink">
          {body}
        </button>
      ) : (
        <div className="h-full rounded-[18px] border border-hairline bg-white p-4 shadow-[0_1px_2px_rgba(23,23,23,0.04)]">{body}</div>
      )}
    </li>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[18px] border border-hairline bg-white p-4 shadow-[0_1px_2px_rgba(23,23,23,0.04)] md:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[17px] font-bold">{title}</h2>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const shortMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const shortRupees = (paise: number) => {
  const r = paise / 100;
  if (Math.abs(r) >= 100000) return `₹${(r / 100000).toFixed(r % 100000 ? 1 : 0)}L`;
  if (Math.abs(r) >= 1000) return `₹${(r / 1000).toFixed(r % 1000 ? 1 : 0)}k`;
  return `₹${Math.round(r)}`;
};

/** 12 bars, one per month; this month in ink, the rest in taupe. */
function RevenueChart({ data, width = 640 }: { data: { month: string; paise: number }[]; width?: number }) {
  const max = Math.max(1, ...data.map((d) => d.paise));
  const W = width;
  const H = 200;
  const left = 8;
  const bw = (W - left * 2) / data.length;
  const total = data.reduce((s, d) => s + d.paise, 0);
  if (total === 0) return <p className="py-10 text-center text-[15px] text-muted">No payments in the last {data.length} months yet.</p>;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 40}`} className="h-auto w-full" role="img" aria-label={`Revenue by month: ${data.map((d) => `${monthTitle(`${d.month}-01`)} ${formatPaise(d.paise)}`).join(', ')}`}>
        <line x1={left} x2={W - left} y1={H} y2={H} stroke="var(--color-hairline)" />
        {data.map((d, i) => {
          const h = Math.max(0, (d.paise / max) * (H - 24));
          const x = left + i * bw + bw * 0.18;
          const w = bw * 0.64;
          const last = i === data.length - 1;
          return (
            <g key={d.month}>
              <rect x={x} y={H - h} width={w} height={h} rx="4" fill={last ? 'var(--color-ink)' : 'var(--color-taupe)'} opacity={last ? 1 : 0.55} />
              {d.paise > 0 && (
                <text x={x + w / 2} y={H - h - 6} textAnchor="middle" fontSize="12" fill="var(--color-ink)">
                  {shortRupees(d.paise)}
                </text>
              )}
              <text x={x + w / 2} y={H + 20} textAnchor="middle" fontSize="12.5" fill="var(--color-muted)">
                {shortMonth(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">Monthly revenue for the last 12 months.</figcaption>
    </figure>
  );
}

function Occupancy({ data }: { data: DashboardData['occupancy'] }) {
  return (
    <div className="space-y-4">
      {data.map((m) => (
        <div key={m.month}>
          <p className="text-[14px] font-semibold">{monthTitle(`${m.month}-01`)}</p>
          <ul className="mt-2 space-y-2">
            {m.units.map((u) => (
              <li key={u.unit}>
                <div className="flex justify-between text-[13.5px]">
                  <span>{UNIT_ROOM_NAME[u.unit]}</span>
                  <span className="tabular-nums text-muted">
                    {u.booked}/{m.days} nights · {u.percent}%{u.blocked ? ` · ${u.blocked} blocked` : ''}
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-card" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.percent} aria-label={`${UNIT_ROOM_NAME[u.unit]} occupancy`}>
                  <div className="h-full rounded-full bg-taupe" style={{ width: `${Math.min(100, u.percent)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BookingList({ items, empty, onOpen, showDate }: { items: BookingSummary[]; empty: string; onOpen: (ref: string) => void; showDate: 'checkIn' | 'created' }) {
  if (items.length === 0) return <p className="py-6 text-[15px] text-muted">{empty}</p>;
  return (
    <ul className="-mx-2 divide-y divide-hairline">
      {items.map((b) => (
        <li key={b.ref}>
          <button onClick={() => onOpen(b.ref)} className="w-full rounded-[12px] px-2 py-2.5 text-left hover:bg-cream">
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{b.guestName}</span>
                <span className="block text-[13.5px] text-muted">
                  {b.roomName} · {formatISODate(b.checkIn)} · {nightsLabel(b.nights)}
                </span>
                {showDate === 'created' && <span className="block text-[12.5px] text-muted">Booked {when(b.createdAt)}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <BookingChip status={b.status} />
                {b.payment !== 'none' && <Chip tone={PAYMENT_LABEL[b.payment][1]}>{PAYMENT_LABEL[b.payment][0]}</Chip>}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const KIND_LABEL: Record<AdminNotification['kind'], string> = { request: 'Enquiry', payment: 'Payment', cancellation: 'Cancelled', checkin: 'Check-in' };

export function Notifications({ items, onOpenBooking, onGo, limit = 8 }: { items: AdminNotification[]; onOpenBooking: (ref: string) => void; onGo: (tab: Go) => void; limit?: number }) {
  if (items.length === 0) return <p className="py-6 text-[15px] text-muted">Nothing needs attention right now.</p>;
  return (
    <ul className="-mx-2 divide-y divide-hairline">
      {items.slice(0, limit).map((n, i) => (
        <li key={`${n.kind}-${n.ref ?? n.requestId}-${i}`}>
          <button
            onClick={() => (n.ref ? onOpenBooking(n.ref) : onGo('requests'))}
            className="flex w-full items-start gap-3 rounded-[12px] px-2 py-2.5 text-left hover:bg-cream"
          >
            <Chip tone={n.kind === 'cancellation' ? 'danger' : n.kind === 'checkin' ? 'success' : 'warn'}>{n.kind === 'cancellation' && n.title.startsWith('Rejected') ? 'Rejected' : KIND_LABEL[n.kind]}</Chip>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold">{n.title}</span>
              <span className="block text-[13px] text-muted">{n.detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
