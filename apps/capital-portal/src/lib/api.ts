import { getCredential } from './session';

const API_BASE_URL = process.env.NEO_LLOYDS_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Request failed with status ${status}`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Every call to the Neo-Lloyds API from this portal goes through here —
 * server-side only (Server Components / Server Actions), so the credential
 * read from the session cookie never reaches the browser. This is a thin
 * pass-through, not a second API client: it does not reshape responses or
 * hide the SIMULATION notice every response carries.
 */
export async function apiFetch<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; credential?: string } = {},
): Promise<T> {
  const credential = init.credential ?? (await getCredential());
  if (!credential) throw new ApiError(401, { message: 'No session credential' });

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json',
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') ?? '';
  const parsed = contentType.includes('application/json') ? await response.json() : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, parsed);
  }

  return parsed as T;
}
