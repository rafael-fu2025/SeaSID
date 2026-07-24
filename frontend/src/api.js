const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const AUTH_TOKEN_KEY = 'seasid.authToken';

function readAuthToken() {
  try { return window.localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

export function setAuthToken(token) {
  try {
    if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    else window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}

export function clearAuthToken() {
  setAuthToken(null);
}

function authHeaders() {
  const token = readAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * streamChat — async generator that POSTs the user message to
 * `/api/v1/agent/chat/stream` and yields each `{type, ...}` event
 * emitted by the FastAPI `StreamingResponse` (SSE format).
 *
 * Each event arrives as `data: {json}\n\n`. We:
 *  1. Read from the response body's `ReadableStream` chunk by chunk
 *  2. Buffer partial lines until we see a blank line
 *  3. Parse each `data:` line as JSON, ignoring any non-JSON heartbeats
 *  4. Hand the parsed object to the caller's `for-await` loop
 *
 * `signal` lets the caller abort via `AbortController.abort()`; the
 * fetch promise rejects and the generator unwinds cleanly.
 */
export async function* streamChat({ message, conversationId, siteKey, signal }) {
  const res = await fetch(`${API_BASE}/api/v1/agent/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      site_key: siteKey,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    if (res.status === 401) {
      clearAuthToken();
      window.dispatchEvent(new CustomEvent('seasid:auth-expired'));
    }
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(
      `Backend error ${res.status}${detail ? ': ' + detail : ''}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          try {
            yield JSON.parse(payload);
          } catch {
            // Skip malformed lines instead of crashing the whole stream.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const { skipAuth = false, ...fetchOptions } = options;
  const res = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(skipAuth ? {} : authHeaders()),
      ...fetchOptions.headers,
    },
  });
  if (res.status === 401) {
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('seasid:auth-expired'));
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Authentication
  login: (username, password) =>
    request('/api/v1/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ username, password }),
    }),
  me: () => request('/api/v1/auth/me'),

  // Health
  health: () => request('/api/v1/health'),

  // Sites
  getSites: () => request('/api/v1/sites'),

  // Agent
  getAgentTools: () => request('/api/v1/agent/tools'),

  // Forecast
  getForecast: (siteKey, hours = 48) =>
    request(`/api/v1/forecast?site=${siteKey}&hours=${hours}`),

  // Labels
  getLabels: (siteKey = 'all', limit = 50) =>
    request(`/api/v1/labels?site=${siteKey}&limit=${limit}`),

  // Ingest
  ingest: (siteKey, hours = 48) =>
    request('/api/v1/ingest', {
      method: 'POST',
      body: JSON.stringify({ site_key: siteKey, hours }),
    }),

  // Verify
  verify: (data) =>
    request('/api/v1/verify', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Alerts
  getAlerts: (siteKey, hours = 24) => {
    const params = new URLSearchParams({ hours });
    if (siteKey) params.set('site', siteKey);
    return request(`/api/v1/alerts?${params}`);
  },

  // Agent
  chat: (message, conversationId, siteKey) =>
    request('/api/v1/agent/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        site_key: siteKey,
      }),
    }),

  getBriefing: (siteKey) => request(`/api/v1/agent/briefing?site=${siteKey}`),

  // Experiments
  getExperimentResults: () => request('/api/v1/experiments/results'),
  runExperiments: () => request('/api/v1/experiments/run', { method: 'POST' }),
  // Streaming variant — opens an SSE connection and invokes the
  // supplied callbacks for every event (`log`, `metric`, `status`,
  // `done`, `error`). Returns a `close()` function so the UI can abort
  // mid-run (e.g. on tab navigation).
  runExperimentsStream: ({ onStatus, onLog, onMetric, onDone, onError, signal } = {}) => {
    // We POST instead of using EventSource because the browser's
    // built-in EventSource is GET-only, and the experiment suite is a
    // state-changing write (reloads the active model, invalidates the
    // forecast cache). Reusing the same fetch+ReadableStream pattern
    // the agent chat stream already uses keeps the wire format
    // (newline-delimited `data: {json}` SSE frames) identical to the
    // backend's StreamingResponse.
    const url = `${API_BASE}/api/v1/experiments/run/stream`;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      controller.abort();
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    (async () => {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          signal: controller.signal,
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          onError?.(`Lost connection to experiment stream: ${err.message || err}`);
        }
        return;
      }
      if (!res.ok || !res.body) {
        onError?.(`Experiment stream failed: HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are terminated by a blank line (\n\n).
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            for (const raw of frame.split('\n')) {
              if (!raw.startsWith('data: ')) continue;
              const data = raw.slice(6);
              let payload;
              try { payload = JSON.parse(data); } catch { continue; }
              switch (payload.type) {
                case 'status':   onStatus?.(payload); break;
                case 'log':      onLog?.(payload.line || ''); break;
                case 'metric':   onMetric?.(payload); break;
                case 'done':     onDone?.(payload); break;
                case 'error':    onError?.(payload.message || 'Experiment failed'); break;
                default: break;
              }
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          onError?.(`Stream interrupted: ${err.message || err}`);
        }
      }
    })();

    return close;
  },

  // Active learning (Phase 8) — past dates where operator confirmation
  // would teach the model the most.
  getActiveLearningSuggestions: (siteKey, { days = 7, topN = 3 } = {}) =>
    request(
      `/api/v1/active-learning/suggestions?site=${siteKey}&days=${days}&top_n=${topN}`,
    ),
  getActiveLearningSummary: () => request('/api/v1/active-learning/summary'),

  // Self-service
  changePassword: (currentPassword, newPassword) =>
    request('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  // Admin: users
  listUsers: () => request('/api/v1/admin/users'),
  createUser: (payload) =>
    request('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id, payload) =>
    request(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteUser: (id) => request(`/api/v1/admin/users/${id}`, { method: 'DELETE' }),

  // Admin: provider API keys
  listApiKeys: () => request('/api/v1/admin/api-keys'),
  createApiKey: (payload) =>
    request('/api/v1/admin/api-keys', { method: 'POST', body: JSON.stringify(payload) }),
  updateApiKey: (id, payload) =>
    request(`/api/v1/admin/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteApiKey: (id) => request(`/api/v1/admin/api-keys/${id}`, { method: 'DELETE' }),
  revealApiKey: (id) =>
    request(`/api/v1/admin/api-keys/${id}/reveal`, { method: 'POST' }),
  testApiKey: (id) =>
    request(`/api/v1/admin/api-keys/${id}/test`, { method: 'POST' }),
  updateProviderConfig: (provider, payload) =>
    request(`/api/v1/admin/provider-configs/${provider}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
};
