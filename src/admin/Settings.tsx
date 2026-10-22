// Settings: room prices, seasonal prices, stay details & house rules, and the audit log.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatPaise } from '../../shared/catalog.ts';
import type { PropertySettings, PublicRoom } from '../../shared/types.ts';
import { Alert, Field, Spinner } from '../components/ui';
import { formatISODate, useAdmin, when } from './lib';

export function RoomsTab() {
  const { call } = useAdmin();
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    call<PublicRoom[]>('/rooms')
      .then(setRooms)
      .catch((e) => setError((e as Error).message));
  }, [call]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!rooms) return <p className="flex justify-center gap-2 py-16 text-muted"><Spinner /> Loading…</p>;
  return (
    <div className="max-w-[760px] space-y-3">
      <p className="text-[13.5px] text-muted">Prices apply to new bookings immediately. Existing bookings keep the price they were booked at. Every change is audit-logged.</p>
      {rooms.map((r) => (
        <RoomEditor key={r.id} room={r} onSaved={setRooms} />
      ))}
    </div>
  );
}

function RoomEditor({ room, onSaved }: { room: PublicRoom; onSaved: (r: PublicRoom[]) => void }) {
  const { call } = useAdmin();
  const [price, setPrice] = useState(String(room.pricePaise / 100));
  const [bookable, setBookable] = useState(room.bookable);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const dirty = Number(price) * 100 !== room.pricePaise || bookable !== room.bookable;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      onSaved(await call<PublicRoom[]>(`/rooms/${room.id}`, { method: 'PUT', body: { price: Number(price), bookable, note } }));
      setNote('');
      setMsg({ tone: 'success', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    }
  };
  return (
    <form onSubmit={save} className="grid gap-3 rounded-[18px] border border-hairline bg-white p-4 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1.3fr)_auto] md:items-end">
      <div>
        <p className="font-semibold">{room.name}</p>
        <label className="mt-1.5 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={bookable} onChange={(e) => setBookable(e.target.checked)} className="size-4 accent-ink" />
          Bookable online
        </label>
      </div>
      <Field id={`price-${room.id}`} label="₹ per night">
        <input id={`price-${room.id}`} className="field" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Field id={`note-${room.id}`} label="Reason">
        <input id={`note-${room.id}`} className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Festival rate" />
      </Field>
      <button className="btn btn-dark h-[46px] px-5 text-[13.5px] disabled:opacity-40" disabled={!dirty || note.trim().length < 3}>
        Save
      </button>
      {msg && <p className={`text-[12.5px] md:col-span-4 ${msg.tone === 'success' ? 'text-[#24603a]' : 'text-[#b42318]'}`}>{msg.text}</p>}
    </form>
  );
}

export function AuditTab() {
  const { call } = useAdmin();
  const [rows, setRows] = useState<{ at: string; actor: string; action: string; details: string; ref: string | null }[] | null>(null);
  useEffect(() => {
    call<typeof rows>('/audit?limit=300').then(setRows).catch(() => setRows([]));
  }, [call]);
  if (!rows) return <p className="flex justify-center gap-2 py-16 text-muted"><Spinner /> Loading…</p>;
  return (
    <div className="overflow-x-auto rounded-[18px] border border-hairline bg-white">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="bg-cream text-[12px] uppercase tracking-[0.08em] text-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">When</th>
            <th className="px-4 py-3 font-semibold">Who</th>
            <th className="px-4 py-3 font-semibold">Action</th>
            <th className="px-4 py-3 font-semibold">Booking</th>
            <th className="px-4 py-3 font-semibold">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              <td className="whitespace-nowrap px-4 py-2.5">{when(r.at)}</td>
              <td className="px-4 py-2.5">{r.actor}</td>
              <td className="px-4 py-2.5 font-medium">{r.action}</td>
              <td className="px-4 py-2.5">{r.ref ?? '—'}</td>
              <td className="max-w-[420px] break-all px-4 py-2.5 text-muted">{r.details === '{}' ? '' : r.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- stay details & house rules (shown on the public policy pages) ----------

const STAY_FIELDS: { key: keyof PropertySettings; label: string; hint: string; number?: boolean }[] = [
  { key: 'checkInTime', label: 'Check-in time', hint: 'e.g. 12:00 PM' },
  { key: 'checkOutTime', label: 'Check-out time', hint: 'e.g. 11:00 AM' },
  { key: 'advanceRequired', label: 'Advance required', hint: 'e.g. 50% of the first night’s tariff' },
  { key: 'freeCancellationHours', label: 'Free cancellation (hours before check-in)', hint: 'e.g. 48', number: true },
  { key: 'lateCancellationCharge', label: 'Late cancellation charge', hint: 'e.g. the advance paid is non-refundable' },
  { key: 'refundDays', label: 'Refund time (days)', hint: 'e.g. 7', number: true },
  { key: 'smoking', label: 'Smoking', hint: 'e.g. not allowed indoors' },
  { key: 'alcohol', label: 'Alcohol', hint: 'e.g. allowed in moderation' },
  { key: 'pets', label: 'Pets', hint: 'e.g. not allowed' },
  { key: 'visitors', label: 'Visitors', hint: 'e.g. allowed until 9 PM' },
  { key: 'quietHours', label: 'Quiet hours', hint: 'e.g. 10 PM – 7 AM' },
  { key: 'securityDeposit', label: 'Security deposit', hint: 'e.g. ₹1,000, refunded at check-out' },
  { key: 'eventDeposit', label: 'Deposit for parties / events', hint: 'e.g. ₹5,000' },
];

export function StayDetailsForm() {
  const { call, refreshProperty } = useAdmin();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<PropertySettings>('/property')
      .then((p) => setValues(Object.fromEntries(STAY_FIELDS.map((f) => [f.key, p[f.key] === null ? '' : String(p[f.key])]))))
      .catch((e) => setMsg({ tone: 'danger', text: (e as Error).message }));
  }, [call]);
  if (!values) return msg ? <Alert tone="danger">{msg.text}</Alert> : <p className="flex justify-center gap-2 py-10 text-muted"><Spinner /> Loading…</p>;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await call('/property', { method: 'PUT', body: values });
      refreshProperty();
      setMsg({ tone: 'success', text: 'Saved. The policy pages and confirmation messages now use these details.' });
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="max-w-[760px] rounded-[18px] border border-hairline bg-white p-4 md:p-5">
      <p className="text-[14px] text-muted">These appear on the website’s House Rules, Terms and Cancellation pages, and in booking confirmations. Leave a field empty to hide it.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {STAY_FIELDS.map((f) => (
          <Field key={f.key} id={`stay-${f.key}`} label={f.label} hint={f.hint}>
            <input
              id={`stay-${f.key}`}
              className="field h-12 text-[16px]"
              inputMode={f.number ? 'numeric' : undefined}
              value={values[f.key]}
              maxLength={160}
              onChange={(e) => setValues((v) => ({ ...v!, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      {msg && (
        <div className="mt-4">
          <Alert tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
            {msg.text}
          </Alert>
        </div>
      )}
      <button className="btn btn-dark mt-4 h-12 px-6 text-[16px] disabled:opacity-60" disabled={busy}>
        {busy ? <Spinner label="Saving" /> : 'Save details'}
      </button>
    </form>
  );
}

// ---------- seasonal prices ----------

type Seasonal = { id: string; room_id: string; from: string; to: string; price_paise: number; label: string };
const ROOM_NAMES: Record<string, string> = { 'ac-1bhk': 'AC 1BHK', 'nonac-1bhk': 'Non-AC 1BHK', '2bhk': '2BHK (AC + Non-AC)' };

export function SeasonalPrices() {
  const { call } = useAdmin();
  const [rows, setRows] = useState<Seasonal[] | null>(null);
  const [form, setForm] = useState({ roomId: 'ac-1bhk', from: '', to: '', price: '', label: '' });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const load = useCallback(() => {
    call<Seasonal[]>('/seasonal-prices')
      .then(setRows)
      .catch((e) => setMsg({ tone: 'danger', text: (e as Error).message }));
  }, [call]);
  useEffect(load, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call('/seasonal-prices', { method: 'POST', body: { ...form, price: Number(form.price) } });
      setForm((f) => ({ ...f, from: '', to: '', price: '', label: '' }));
      setMsg({ tone: 'success', text: 'Seasonal price added. New quotes use it straight away.' });
      load();
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    }
  };
  const remove = async (id: string) => {
    setConfirmDelete(null);
    try {
      await call(`/seasonal-prices/${id}`, { method: 'DELETE' });
      setMsg({ tone: 'success', text: 'Seasonal price removed.' });
      load();
    } catch (err) {
      setMsg({ tone: 'danger', text: (err as Error).message });
    }
  };
  return (
    <div className="max-w-[760px] space-y-4">
      <p className="text-[14px] text-muted">
        Charge a different nightly price for festivals or peak weeks. It applies to the nights from the first to the last date (inclusive) for new bookings; existing bookings keep their price.
      </p>
      {rows === null ? (
        <p className="flex gap-2 text-muted">
          <Spinner /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-[14px] bg-card px-4 py-4 text-[15px] text-muted">No seasonal prices — the normal nightly prices apply.</p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-[16px] border border-hairline bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 text-[15px]">
                <span className="font-semibold">{ROOM_NAMES[r.room_id] ?? r.room_id}</span> · {formatPaise(r.price_paise)}/night{r.label ? ` · ${r.label}` : ''}
                <span className="block text-[13.5px] text-muted">
                  Nights {formatISODate(r.from)} → {formatISODate(r.to)}
                </span>
              </span>
              {confirmDelete === r.id ? (
                <span className="flex gap-2">
                  <button onClick={() => setConfirmDelete(null)} className="btn btn-outline h-10 px-4 text-[14px]">
                    Keep
                  </button>
                  <button onClick={() => remove(r.id)} className="btn h-10 bg-[#a3261b] px-4 text-[14px] text-white hover:bg-[#8a1f16]">
                    Remove
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(r.id)} className="btn btn-outline h-10 px-4 text-[14px]">
                  Remove…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-3 rounded-[18px] border border-hairline bg-white p-4 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_0.8fr] lg:items-end">
        <Field id="sp-room" label="Room">
          <select id="sp-room" className="field h-12 text-[16px]" value={form.roomId} onChange={(e) => setForm((f) => ({ ...f, roomId: e.target.value }))}>
            {Object.entries(ROOM_NAMES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="sp-from" label="First night">
          <input
            id="sp-from"
            type="date"
            className="field h-12 text-[16px]"
            value={form.from}
            onChange={(e) => setForm((f) => ({ ...f, from: e.target.value, to: f.to && f.to >= e.target.value ? f.to : e.target.value }))}
          />
        </Field>
        <Field id="sp-to" label="Last night">
          <input id="sp-to" type="date" className="field h-12 text-[16px]" min={form.from || undefined} value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} />
        </Field>
        <Field id="sp-price" label="₹ per night">
          <input id="sp-price" className="field h-12 text-[16px]" inputMode="numeric" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
        </Field>
        <div className="md:col-span-2 lg:col-span-3">
          <Field id="sp-label" label="Name" optional>
            <input id="sp-label" className="field h-12 text-[16px]" maxLength={40} placeholder="e.g. Durga Puja" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </Field>
        </div>
        <button className="btn btn-dark h-12 px-5 text-[16px] disabled:opacity-50" disabled={!form.from || !form.to || !form.price}>
          Add
        </button>
      </form>
      {msg && (
        <Alert tone={msg.tone} role={msg.tone === 'danger' ? 'alert' : 'status'}>
          {msg.text}
        </Alert>
      )}
    </div>
  );
}
