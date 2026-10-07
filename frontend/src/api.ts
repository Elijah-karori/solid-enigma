// API client. The short-lived ACCESS token lives only in memory (never localStorage, so XSS cannot
// steal a long-lived credential). The REFRESH token is an httpOnly cookie the browser sends only to
// /api/auth/*. On a 401 the client refreshes once and retries; if that fails the user is signed out.

export interface ApiFetchOptions extends RequestInit {
  token?: string | null;
}

let accessToken: string | null = null;
export const getAuthToken = (): string | null => accessToken;
export const setAuthToken = (t: string | null): void => {
  accessToken = t;
};
export const clearAuthToken = (): void => {
  accessToken = null;
  localStorage.removeItem('token'); // legacy keys from the old build
  localStorage.removeItem('user');
};

export interface SessionPayload {
  access_token: string;
  expires_in: number;
  user: import('./types').User;
  permissions: Record<string, boolean>;
}

let refreshing: Promise<SessionPayload | null> | null = null;

/** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<SessionPayload | null> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return null;
        const data = (await r.json()) as SessionPayload;
        accessToken = data.access_token;
        return data;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function parseError(response: Response): Promise<string> {
  let msg = `Server error ${response.status}`;
  try {
    const j = await response.json();
    if (j && j.error) msg = j.error;
  } catch {
    /* non-JSON error body */
  }
  return msg;
}

export async function apiFetch<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const isAuthRoute = url.startsWith('/api/auth/');
  const run = (tok: string | null) => {
    const headers: Record<string, string> = { ...((options.headers as Record<string, string>) || {}) };
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(url, { ...options, headers, credentials: 'include' });
  };

  let response = await run(options.token !== undefined ? options.token : accessToken);

  if (response.status === 401 && !isAuthRoute) {
    const renewed = await refreshSession();
    if (renewed) {
      response = await run(renewed.access_token);
    }
    if (response.status === 401) {
      clearAuthToken();
      window.dispatchEvent(new CustomEvent('unauthorized-access'));
      throw new Error('Session ended. Please sign in again.');
    }
  }
  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as T;
}
