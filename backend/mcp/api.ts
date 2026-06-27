// HTTP client from the MCP relay to Plynth's REST API.
//
// The relay never sends "who I am" as a parameter — identity is the BYOA
// artifact. With DioscHub the artifact arrives PER CALL inside the MCP request
// `_meta.headers.Authorization` (the hub injects the session's bound auth on
// every tool call); Plynth's `deviceCookie` middleware verifies it back into a
// device sandbox. For local stdio testing it falls back to the PLYNTH_ARTIFACT
// env var. Plynth's REST returns raw JSON (no envelope), so we treat any 2xx as
// success and surface the Nest error `message` on failure.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE = (process.env.PLYNTH_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const ENV_ARTIFACT = process.env.PLYNTH_ARTIFACT ?? '';

export interface ApiResult {
  ok: boolean;
  data?: unknown;
  message?: string;
  status: number;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The per-call request context the SDK hands a tool callback. */
export interface ToolExtra {
  _meta?: { headers?: Record<string, string>; [k: string]: unknown };
}

/** Pull the BYOA artifact for this call: per-call _meta header first, env fallback. */
export function artifactFor(extra?: ToolExtra): string {
  const headers = extra?._meta?.headers ?? {};
  const auth = headers.Authorization ?? headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return ENV_ARTIFACT;
}

export async function call(method: Method, path: string, payload: unknown, artifact: string): Promise<ApiResult> {
  const headers: Record<string, string> = { authorization: `Bearer ${artifact}` };
  if (payload !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
  } catch (err) {
    return { ok: false, message: `Plynth API unreachable: ${(err as Error).message}`, status: 0 };
  }

  if (res.status === 204) return { ok: true, data: null, status: 204 };

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = (json && (json.message || json.error)) || res.statusText || 'Request failed';
    return { ok: false, message: String(message), status: res.status };
  }
  return { ok: true, data: json, status: res.status };
}

/**
 * Convert a REST result into an MCP tool result. Success returns the data as
 * JSON text; failure returns a structured `{ error: { message } }` AND sets
 * isError, so the model sees *why* it failed and can explain or retry.
 */
export function toToolResult(api: ApiResult): CallToolResult {
  if (api.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(api.data ?? null) }] };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: { message: api.message ?? 'Request failed', status: api.status } }) }],
    isError: true,
  };
}

/** Resolve the artifact for this call, hit the API, and map to a tool result. */
export async function relay(extra: ToolExtra | undefined, method: Method, path: string, payload?: unknown): Promise<CallToolResult> {
  return toToolResult(await call(method, path, payload, artifactFor(extra)));
}

export function enc(segment: string): string {
  return encodeURIComponent(segment);
}
