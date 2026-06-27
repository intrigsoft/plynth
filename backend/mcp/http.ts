// HTTP entry point — run with `npm run mcp:http` (default port 5174).
//
// This is the transport DioscHub connects to (the hub supports http/sse, not
// stdio). Register it as an MCP instance with serverUrl http://<host>:5174/mcp,
// transportType "http". Per-user identity arrives in each call's `_meta.headers`
// (the hub injects the session's bound BYOA auth) — see mcp/api.ts.
//
// Stateless: a fresh server+transport per request, identity resolved per call.
import { createServer, type IncomingMessage } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createPlynthMcpServer } from './server.js';

// Prefer the platform-injected PORT (Railway/Heroku set this) so the public
// proxy can reach us; fall back to PLYNTH_MCP_PORT, then the dev default.
const PORT = Number(process.env.PORT ?? process.env.PLYNTH_MCP_PORT ?? 5174);

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

const httpServer = createServer(async (req, res) => {
  const path = (req.url ?? '').replace(/\?.*$/, '');
  if (path !== '/mcp') {
    res.writeHead(404).end();
    return;
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const rpc = body as { method?: string; params?: { name?: string } } | undefined;
    if (rpc?.method) console.error(`[mcp] ${rpc.method}${rpc.params?.name ? ` ${rpc.params.name}` : ''}`);
    const server = createPlynthMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' }).end(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }),
  );
});

httpServer.listen(PORT, () => {
  // stderr so it never pollutes a stdout protocol stream
  console.error(`Plynth MCP (HTTP) listening on http://localhost:${PORT}/mcp`);
});
