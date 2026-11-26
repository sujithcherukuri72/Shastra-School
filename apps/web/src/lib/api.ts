import { QueryClient, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

export class ApiError extends Error {
  status: number;
  details?: { field: string; message: string }[];
  constructor(status: number, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const OFFLINE_MESSAGE = 'Can’t reach the Shastra Connect server. Check your connection and try again.';

/** The CSRF token lives in a readable cookie; it is echoed in a header on every write. */
function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)(?:__Host-)?sc_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(503, OFFLINE_MESSAGE);
  }
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('sc:signed-out'));
    if (!data && res.status >= 502) throw new ApiError(res.status, OFFLINE_MESSAGE);
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: true },
  },
});

/** GET with caching, keyed by path. Pass null to skip. */
export function useApi<T = any>(path: string | null, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api.get<T>(path!), enabled: !!path, ...opts });
}

/** Mutation that refreshes every cached GET whose path starts with one of `invalidate`. */
export function useAction<TVars = any, TRes = any>(fn: (v: TVars) => Promise<TRes>, invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation<TRes, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      for (const prefix of invalidate) {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix) });
      }
    },
  });
}

/** Download a protected file through fetch (cookies stay HttpOnly) and save it. */
export async function download(path: string, fallbackName = 'download') {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'Could not download the file');
  const cd = res.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? cd.match(/filename="([^"]+)"/)?.[1] ?? fallbackName);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Open a protected PDF/image in a new tab (blob URL, so no token ever appears in a URL). */
export async function openFile(path: string) {
  const w = window.open('', '_blank');
  if (w) w.opener = null;
  const res = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}inline=1`, { credentials: 'same-origin' });
  if (!res.ok) {
    w?.close();
    throw new ApiError(res.status, 'Could not open the file');
  }
  const url = URL.createObjectURL(await res.blob());
  if (w) w.location.href = url;
  else window.location.href = url;
}
