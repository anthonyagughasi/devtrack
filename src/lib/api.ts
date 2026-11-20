import { auth } from './firebase';

export class ApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  const user = auth.currentUser;
  if (user && !headers.has('Authorization')) {
    try {
      const token = await user.getIdToken();
      headers.set('Authorization', `Bearer ${token}`);
    } catch {
      // Fall back to HttpOnly session cookie if Firebase token refresh fails
    }
  }

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await response.text();
  let data: unknown = null;
  let parsedValidJson = false;
  if (text) {
    try {
      data = JSON.parse(text);
      parsedValidJson = true;
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message);
  }

  if (response.status !== 204 && (!parsedValidJson || data === null || data === undefined)) {
    throw new ApiError(
      response.status,
      'The server returned an unexpected response. Please try again.'
    );
  }

  return data as T;
}
