const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      site_key: siteKey,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
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
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Health
  health: () => request('/api/v1/health'),

  // Sites
  getSites: () => request('/api/v1/sites'),

  // Forecast
  getForecast: (siteKey) => request(`/api/v1/forecast?site=${siteKey}`),

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

  // Active learning (Phase 8) — past dates where operator confirmation
  // would teach the model the most.
  getActiveLearningSuggestions: (siteKey, { days = 7, topN = 3 } = {}) =>
    request(
      `/api/v1/active-learning/suggestions?site=${siteKey}&days=${days}&top_n=${topN}`,
    ),
  getActiveLearningSummary: () => request('/api/v1/active-learning/summary'),
};
