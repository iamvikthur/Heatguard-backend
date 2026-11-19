export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5500';
const TOKEN_KEY = 'heatguard.token';
const USER_KEY = 'heatguard.user';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'SUPERVISOR' | 'HSE' | 'ADMIN';
}

export type Level = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';

export interface Site {
  id: string;
  name: string;
  timezone: string;
  restArea: 'SUN' | 'SHADE' | 'COOLED';
  restWbgtC: number | null;
  crews: { id: string; name: string }[];
}

export interface OutlookHour {
  validAt: string;
  horizonMin: number;
  level: Level;
  workMin: number;
  restMin: number;
  workMinRestInSun: number | null;
  wbgtC: number;
  limitC: number;
  restWbgtC: number | null;
  fallback: boolean;
  workersAtHigherLevel: number;
}

export interface Outlook {
  siteId: string;
  computedAt: string | null;
  isReplay: boolean;
  crews: { crewId: string; name: string; hours: OutlookHour[] }[];
}

export interface NeedsCheckEntry {
  id: string;
  reason: 'RED_FLAG' | 'SYMPTOM';
  body: string;
  createdAt: string;
  worker: { id: string; pseudonym: string } | null;
}

export interface WorkerToday {
  worker: {
    id: string;
    pseudonym: string;
    language: string;
    direction: 'ltr' | 'rtl';
    crewName: string;
    siteName: string;
    timezone: string;
  };
  schedule: {
    level: Level;
    workMin: number;
    restMin: number;
    validAt: string;
    isOwn: boolean;
    reasons: string[];
  } | null;
  message: { body: string; language: string; level: Level; createdAt: string } | null;
  consents: Record<'CHECKIN' | 'WEARABLE', boolean>;
  symptomOptions: { name: string; label: string }[];
}

export interface CheckInResult {
  checkInId: string;
  action: 'ESCALATED' | 'URGENT_CHECK' | 'STRICTER_SCHEDULE' | 'CHECK_REQUESTED' | 'NONE';
  reported: string[];
  redFlags: string[];
  disputedFlags: string[];
  extractor: 'LLM' | 'KEYWORD' | 'TAP';
  modelError: string | null;
  needsTapCheckin: boolean;
  schedule: { level: Level; workMin: number; restMin: number } | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const session = {
  token: () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  user: (): User | null => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  },
  save: (token: string, user: User) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = session.token();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* keep the status message */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  sites: () => request<Site[]>('/sites'),
  outlook: (siteId: string, replay: boolean) =>
    request<Outlook>(`/sites/${siteId}/outlook${replay ? '?replay=true' : ''}`),
  needsCheck: (crewId: string) => request<NeedsCheckEntry[]>(`/crews/${crewId}/needs-check`),
  acknowledge: (alertId: string) => request<unknown>(`/alerts/${alertId}/ack`, { method: 'POST' }),
  runSite: (siteId: string) => request<unknown>(`/sites/${siteId}/risk/run`, { method: 'POST' }),
  crewWorkers: (crewId: string) =>
    request<{ id: string; pseudonym: string; language: string; acclimatizedFrom: string }[]>(`/crews/${crewId}/workers`),
  workerToday: (workerId: string, replay: boolean) =>
    request<WorkerToday>(`/workers/${workerId}/today${replay ? '?replay=true' : ''}`),
  setConsent: (workerId: string, scope: 'CHECKIN' | 'WEARABLE', granted: boolean) =>
    request<Record<string, boolean>>(`/workers/${workerId}/consents`, {
      method: 'POST',
      body: JSON.stringify({ scope, granted }),
    }),
  checkIn: (workerId: string, body: { text?: string; taps?: string[]; replay?: boolean }) =>
    request<CheckInResult>(`/workers/${workerId}/checkins`, { method: 'POST', body: JSON.stringify(body) }),
  issueAccessLink: (workerId: string) =>
    request<{ pseudonym: string; url: string; expiresAt: string; note: string }>(
      `/workers/${workerId}/access-link`,
      { method: 'POST' },
    ),
  revokeAccessLink: (workerId: string) =>
    request<{ revoked: boolean }>(`/workers/${workerId}/access-link/revoke`, { method: 'POST' }),
};

/** Time of day at the site, not in the viewer's own time zone. */
export function siteTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: false,
  }).format(new Date(iso));
}

export function siteDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * The three things a worker's page needs. A supervisor reaches them through
 * /workers/:id; a worker reaches them through their own sign-in link, which
 * carries who they are so no id appears in the request.
 */
export interface WorkerApi {
  today(replay: boolean): Promise<WorkerToday>;
  checkIn(body: { text?: string; taps?: string[]; replay?: boolean }): Promise<CheckInResult>;
  setConsent(scope: 'CHECKIN' | 'WEARABLE', granted: boolean): Promise<Record<string, boolean>>;
}

export function staffWorkerApi(workerId: string): WorkerApi {
  return {
    today: (replay) => api.workerToday(workerId, replay),
    checkIn: (body) => api.checkIn(workerId, body),
    setConsent: (scope, granted) => api.setConsent(workerId, scope, granted),
  };
}

export function selfWorkerApi(linkToken: string): WorkerApi {
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(`${API}/worker/me${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${linkToken}`,
      },
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* keep the status message */
      }
      throw new ApiError(message, res.status);
    }
    return (await res.json()) as T;
  };
  return {
    today: (replay) => call<WorkerToday>(`/today${replay ? '?replay=true' : ''}`),
    checkIn: (body) => call<CheckInResult>('/checkins', { method: 'POST', body: JSON.stringify(body) }),
    setConsent: (scope, granted) =>
      call<Record<string, boolean>>('/consents', { method: 'POST', body: JSON.stringify({ scope, granted }) }),
  };
}
