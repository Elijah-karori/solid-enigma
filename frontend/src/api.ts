// Centralized API fetch wrapper handling Auth token and defensive JSON parsing

export interface ApiFetchOptions extends RequestInit {
  token?: string | null;
}

export const getAuthToken = (): string | null => {
  return localStorage.getItem('token');
};

export const setAuthToken = (token: string): void => {
  localStorage.setItem('token', token);
};

export const clearAuthToken = (): void => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};

export async function apiFetch<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T> {
  const token = options.token !== undefined ? options.token : getAuthToken();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('unauthorized-access'));
    throw new Error('Unauthorized session. Please log in.');
  }

  if (!response.ok) {
    let errorMsg = `Server error ${response.status}`;
    try {
      const errData = await response.json();
      if (errData && errData.error) {
        errorMsg = errData.error;
      }
    } catch {
      // ignore json parse error on non-ok response
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  return data as T;
}
