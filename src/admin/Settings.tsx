// "More" tab: room prices and the audit log.

import { useEffect, useState, type FormEvent } from 'react';
import type { PublicRoom } from '../../shared/types.ts';
import { Alert, Field, Spinner } from '../components/ui';
import { useAdmin, when } from './lib';

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
