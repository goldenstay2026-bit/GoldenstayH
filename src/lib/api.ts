import type { ApiError as ApiErrorBody } from '../../shared/types.ts';

export class ApiError extends Error {
  status: number;
  code?: string;
  field?: string;
  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.error || 'Something went wrong. Please try again.');
    this.status = status;
    this.code = body.code;
    this.field = body.field;
  }
}

type Opts = { method?: string; body?: unknown; token?: string; idToken?: string | null; signal?: AbortSignal };

/** JSON fetch against the Golden Stay API. Throws ApiError with a user-safe message. */
export async function api<T>(path: string, { method = 'GET', body, token, idToken, signal }: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Booking-Token': token } : {}),
        // Firebase ID token of the signed-in guest (verified on the server).
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, { error: 'Can’t reach Golden Stay right now. Check your connection and try again.', code: 'NETWORK' });
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const json = (await res.json().catch(() => ({}))) as unknown;
  // Cancelled while the body was downloading: don't hand back an empty object as data.
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // No JSON at all = the booking server isn't there (e.g. a static-only host): say so plainly.
  if (!isJson) {
    throw new ApiError(res.status || 503, {
      error: 'Online booking isn’t available right now. Please enquire on WhatsApp or call +91 91010 87949.',
      code: 'API_UNAVAILABLE',
    });
  }
  if (!res.ok) throw new ApiError(res.status, json as Partial<ApiErrorBody>);
  return json as T;
}
