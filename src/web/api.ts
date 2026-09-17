interface ArtisanalRuntimeConfig {
  apiBase?: string;
}

declare global {
  interface Window {
    __ARTISANAL_CONFIG__?: ArtisanalRuntimeConfig;
  }
}

const apiBase = (window.__ARTISANAL_CONFIG__?.apiBase ?? '').trim().replace(/\/+$/, '');

function apiUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${apiBase}${normalized}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export function apiGet<T>(path: string) {
  return requestJson<T>(path);
}

export function apiPost<T>(path: string, body: unknown = {}) {
  return requestJson<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function apiDisplayBase() {
  return apiBase || window.location.origin;
}
