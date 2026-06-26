import type {
  CreateDocumentDto,
  CreateProjectDto,
  DiagramDoc,
  Project,
  UpdateDocumentDto,
  UpdateProjectDto,
} from '@plynth/shared';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => req<Project[]>('/projects'),
  getProject: (id: string) => req<Project>(`/projects/${id}`),
  createProject: (dto: CreateProjectDto) =>
    req<Project>('/projects', { method: 'POST', body: JSON.stringify(dto) }),
  updateProject: (id: string, dto: UpdateProjectDto) =>
    req<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteProject: (id: string) => req<void>(`/projects/${id}`, { method: 'DELETE' }),

  getDoc: (projectId: string, docId: string) =>
    req<DiagramDoc>(`/projects/${projectId}/documents/${docId}`),
  createDoc: (projectId: string, dto: CreateDocumentDto) =>
    req<DiagramDoc>(`/projects/${projectId}/documents`, { method: 'POST', body: JSON.stringify(dto) }),
  updateDoc: (projectId: string, docId: string, dto: UpdateDocumentDto) =>
    req<DiagramDoc>(`/projects/${projectId}/documents/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
  deleteDoc: (projectId: string, docId: string) =>
    req<void>(`/projects/${projectId}/documents/${docId}`, { method: 'DELETE' }),

  /** Restore this device's sandbox to the seed. */
  resetSandbox: () => req<void>('/sandbox/reset', { method: 'POST' }),
};
