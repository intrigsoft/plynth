/* =============================================================================
 *  Per-device cookie chokepoint (mirrors Cadence's `cadence_device`).
 *  Resolves the visitor's sandbox from the `plynth_device` cookie, minting a
 *  fresh seeded sandbox + setting the cookie on first visit. Runs as a plain
 *  express middleware before everything (so even the initial SPA HTML load
 *  establishes the device).
 * ===========================================================================*/

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { StoreService } from './store.service';

export const DEVICE_COOKIE = 'plynth_device';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function isLocal(host: string | undefined): boolean {
  return !host || host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';
}

export function deviceCookie(store: StoreService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { deviceId, isNew } = store.getOrCreateDevice(readCookie(req.headers.cookie, DEVICE_COOKIE));
    if (isNew) {
      res.cookie(DEVICE_COOKIE, deviceId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: !isLocal(req.hostname),
        maxAge: MAX_AGE_MS,
      });
    }
    (req as Request & { deviceId?: string }).deviceId = deviceId;
    next();
  };
}

/** Inject the resolved device id into a controller handler. */
export const DeviceId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request & { deviceId?: string }>();
  return req.deviceId ?? '';
});
