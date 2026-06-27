// The Plynth MCP server — workspace data tools (projects + documents) the
// DioscHub assistant acts through. Every tool relays to Plynth's REST API,
// carrying the per-call BYOA artifact so it operates on the human's sandbox.
//
// By design the MCP layer owns documents as ENTITIES (create/rename/describe/
// delete) but does NOT write a document's diagram model — that stays client-
// owned in the open editor (browser intents, a later phase). Navigation is a
// hub browser tool; `search_projects`/`search_documents` back its sitemap
// placeholder resolvers (name → id) as well as serving the assistant directly.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { relay, enc, type ToolExtra } from './api.js';

const DIAGRAM_TYPES = ['erd', 'class', 'sequence', 'deployment', 'component', 'flowchart', 'usecase'] as const;

export function createPlynthMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'plynth', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  /* ---- projects -------------------------------------------------------- */

  server.registerTool(
    'list_projects',
    { description: 'List all projects in the current workspace, each with its documents. Use to see what exists before acting.' },
    (x) => relay(x as ToolExtra, 'GET', '/projects'),
  );

  server.registerTool(
    'search_projects',
    { description: 'Find projects by name or description. Returns [{id,name}]. Use to resolve a project id from a name before navigating or acting.', inputSchema: { query: z.string() } },
    ({ query }, x) => relay(x as ToolExtra, 'GET', `/projects/search?q=${encodeURIComponent(query)}`),
  );

  server.registerTool(
    'get_project',
    { description: 'Get one project with all its documents (id, name, type, description). Use to learn document ids before acting on them.', inputSchema: { projectId: z.string() } },
    ({ projectId }, x) => relay(x as ToolExtra, 'GET', `/projects/${enc(projectId)}`),
  );

  server.registerTool(
    'create_project',
    { description: 'Create a new project. Returns the created project (with its id).', inputSchema: { name: z.string(), desc: z.string().optional(), color: z.string().optional() } },
    ({ name, desc, color }, x) => relay(x as ToolExtra, 'POST', '/projects', { name, desc, color }),
  );

  server.registerTool(
    'update_project',
    { description: 'Update a project\'s name, description, or accent color. Pass only the fields to change.', inputSchema: { projectId: z.string(), name: z.string().optional(), desc: z.string().optional(), color: z.string().optional() } },
    ({ projectId, ...patch }, x) => relay(x as ToolExtra, 'PATCH', `/projects/${enc(projectId)}`, patch),
  );

  server.registerTool(
    'delete_project',
    { description: 'Delete a project and all its documents. Destructive — may require approval.', inputSchema: { projectId: z.string() } },
    ({ projectId }, x) => relay(x as ToolExtra, 'DELETE', `/projects/${enc(projectId)}`),
  );

  /* ---- documents ------------------------------------------------------- */

  server.registerTool(
    'search_documents',
    { description: 'Find diagrams by name/description, optionally within one project. Returns [{id,name,type,projectId}]. Use to resolve a document id before navigating.', inputSchema: { query: z.string(), projectId: z.string().optional() } },
    ({ query, projectId }, x) => relay(x as ToolExtra, 'GET', `/projects/documents/search?q=${encodeURIComponent(query)}${projectId ? `&projectId=${enc(projectId)}` : ''}`),
  );

  server.registerTool(
    'get_document',
    { description: 'Get one document including its full diagram model. Use to read what a diagram contains.', inputSchema: { projectId: z.string(), documentId: z.string() } },
    ({ projectId, documentId }, x) => relay(x as ToolExtra, 'GET', `/projects/${enc(projectId)}/documents/${enc(documentId)}`),
  );

  server.registerTool(
    'create_document',
    { description: 'Create a new diagram in a project. Seeds an empty model of the chosen type; the user edits it in the open editor. Returns the created document (with its id). After creating, navigate the user to it.', inputSchema: { projectId: z.string(), name: z.string(), type: z.enum(DIAGRAM_TYPES), desc: z.string().optional() } },
    ({ projectId, name, type, desc }, x) => relay(x as ToolExtra, 'POST', `/projects/${enc(projectId)}/documents`, { name, type, desc }),
  );

  server.registerTool(
    'update_document',
    { description: 'Rename a document or change its description. Does NOT edit the diagram contents (the model is edited live in the open editor). Pass only the fields to change.', inputSchema: { projectId: z.string(), documentId: z.string(), name: z.string().optional(), desc: z.string().optional() } },
    ({ projectId, documentId, ...patch }, x) => relay(x as ToolExtra, 'PATCH', `/projects/${enc(projectId)}/documents/${enc(documentId)}`, patch),
  );

  server.registerTool(
    'delete_document',
    { description: 'Delete a document. Destructive — may require approval.', inputSchema: { projectId: z.string(), documentId: z.string() } },
    ({ projectId, documentId }, x) => relay(x as ToolExtra, 'DELETE', `/projects/${enc(projectId)}/documents/${enc(documentId)}`),
  );

  return server;
}
