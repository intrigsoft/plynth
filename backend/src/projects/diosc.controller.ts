/* =============================================================================
 *  POST /api/diosc/bind — the host bind endpoint the DioscHub assistant-kit calls.
 *
 *  The kit POSTs { wsId } here (same-origin, with credentials so the
 *  `plynth_device` cookie flows). We mint a Plynth BYOA artifact bound to THIS
 *  device's sandbox and forward it to the hub's POST /api/auth/bind, authenticated
 *  with our embed key. The hub then injects the artifact into every MCP tool
 *  call's `_meta.headers.Authorization` — so the assistant acts on the same
 *  sandbox the human is looking at.
 *
 *  Plynth has no real login: the device IS the identity boundary (all data is
 *  device-scoped). The frontend may pass its display-only mock session as
 *  `identity` for nicer attribution; it is never trusted for authorization.
 * ===========================================================================*/

import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { DeviceId } from '../store/device';
import { mintArtifact } from '../store/artifact';

const HUB_URL = (process.env.DIOSC_HUB_URL ?? 'http://localhost:3333').replace(/\/$/, '');
const EMBED_KEY = process.env.DIOSC_EMBED_KEY ?? '';

interface BindBody {
  wsId?: string;
  identity?: { userId?: string; username?: string };
}

@Controller('diosc')
export class DioscController {
  @Post('bind')
  async bind(@DeviceId() deviceId: string, @Body() body: BindBody): Promise<{ ok: true }> {
    const wsId = body?.wsId ?? '';
    if (!wsId) throw new BadRequestException('wsId is required');
    if (!EMBED_KEY) throw new InternalServerErrorException('DIOSC_EMBED_KEY is not configured');
    if (!deviceId) throw new BadRequestException('No device session');

    const { artifact } = mintArtifact({ deviceId });
    const userId = body.identity?.userId || deviceId;
    const username = body.identity?.username || 'Guest';

    let res: Response;
    try {
      res = await fetch(`${HUB_URL}/api/auth/bind`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': EMBED_KEY },
        body: JSON.stringify({
          wsId,
          identity: { userId, username, role: { id: 'user', name: 'user' } },
          authArtifacts: { headers: { Authorization: `Bearer ${artifact}` } },
        }),
      });
    } catch (err) {
      throw new BadGatewayException(`Hub unreachable: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new BadGatewayException(`Hub bind failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return { ok: true };
  }
}
