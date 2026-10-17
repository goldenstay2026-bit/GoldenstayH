import { useEffect, useState } from 'react';
import type { PublicRoom } from '../../shared/types.ts';
import { api } from './api';

let cache: Promise<PublicRoom[]> | null = null;

/**
 * Live room prices and bookability from the server database. Returns null
 * until loaded (and on failure), so callers fall back to the prerendered
 * catalogue prices.
 */
export function useLiveRooms(): Record<string, PublicRoom> | null {
  const [rooms, setRooms] = useState<Record<string, PublicRoom> | null>(null);
  useEffect(() => {
    let alive = true;
    cache ??= api<PublicRoom[]>('/rooms');
    cache
      .then((list) => alive && setRooms(Object.fromEntries(list.map((r) => [r.id, r]))))
      .catch(() => {
        cache = null;
      });
    return () => {
      alive = false;
    };
  }, []);
  return rooms;
}
