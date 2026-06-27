// stdio entry point — local testing only (e.g. MCP Inspector / a desktop client).
// DioscHub uses the HTTP transport (mcp/http.ts), not stdio.
//
// Over stdio there is no per-call `_meta` identity, so set PLYNTH_ARTIFACT to a
// minted artifact (or run against a dev API that accepts the env fallback).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPlynthMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createPlynthMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Plynth MCP (stdio) ready');
}

void main();
