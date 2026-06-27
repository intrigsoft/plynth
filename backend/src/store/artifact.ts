/* =============================================================================
 *  BYOA auth artifact (mirrors Cadence's artifact, simplified for Plynth).
 *
 *  Plynth has no real auth — the "identity" that matters is *which device's
 *  sandbox* a call acts on. So the artifact is a self-contained HMAC-signed
 *  token carrying just { deviceId, exp }. The host (`/api/diosc/bind`) mints it
 *  for the human's device and hands it to DioscHub; the hub then injects it into
 *  every MCP tool call's `_meta.headers.Authorization`. The Plynth REST API
 *  verifies it back into a deviceId — so the assistant acts on the SAME sandbox
 *  the human is looking at. DioscHub and the LLM never inspect it.
 * ===========================================================================*/

import crypto from 'node:crypto';

const SECRET = process.env.PLYNTH_ARTIFACT_SECRET || 'dev-insecure-plynth-artifact-secret';
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8h — a working session

export interface ArtifactClaims {
  deviceId: string;
}

interface Payload extends ArtifactClaims {
  exp: number; // epoch ms
}

function sign(payloadB64: string): string {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

/** Mint an opaque bearer artifact bound to a device sandbox. */
export function mintArtifact(claims: ArtifactClaims, ttlMs: number = DEFAULT_TTL_MS): { artifact: string; expiresAt: string } {
  const exp = Date.now() + ttlMs;
  const payload: Payload = { ...claims, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { artifact: `${payloadB64}.${sign(payloadB64)}`, expiresAt: new Date(exp).toISOString() };
}

/** Verify + decode an artifact. Returns the claims, or null if invalid/expired. */
export function verifyArtifact(token: string | null | undefined): ArtifactClaims | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Payload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (!payload.deviceId) return null;
    return { deviceId: payload.deviceId };
  } catch {
    return null;
  }
}
