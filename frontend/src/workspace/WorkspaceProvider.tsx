import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CreateDocumentDto,
  CreateProjectDto,
  DiagramDoc,
  Project,
  UpdateDocumentDto,
  UpdateProjectDto,
} from '@plynth/shared';
import { api } from '../lib/api';

interface WorkspaceCtx {
  projects: Project[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  project: (id: string) => Project | undefined;
  createProject: (dto: CreateProjectDto) => Promise<Project>;
  updateProject: (id: string, dto: UpdateProjectDto) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  createDoc: (projectId: string, dto: CreateDocumentDto) => Promise<DiagramDoc>;
  updateDoc: (projectId: string, docId: string, dto: UpdateDocumentDto) => Promise<void>;
  /** Update the cached doc model in place (no refetch) — used by the editor's
   *  autosave so thumbnails/re-open reflect edits without churning state. */
  patchDocLocal: (projectId: string, docId: string, model: DiagramDoc['model']) => void;
  deleteDoc: (projectId: string, docId: string) => Promise<void>;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const replaceProject = useCallback((p: Project) => {
    setProjects((cur) => cur.map((x) => (x.id === p.id ? p : x)));
  }, []);

  const value = useMemo<WorkspaceCtx>(
    () => ({
      projects,
      loading,
      error,
      refresh,
      project: (id) => projects.find((p) => p.id === id),
      createProject: async (dto) => {
        const p = await api.createProject(dto);
        setProjects((cur) => [p, ...cur]);
        return p;
      },
      updateProject: async (id, dto) => {
        replaceProject(await api.updateProject(id, dto));
      },
      deleteProject: async (id) => {
        await api.deleteProject(id);
        setProjects((cur) => cur.filter((p) => p.id !== id));
      },
      createDoc: async (projectId, dto) => {
        const doc = await api.createDoc(projectId, dto);
        replaceProject(await api.getProject(projectId));
        return doc;
      },
      updateDoc: async (projectId, docId, dto) => {
        await api.updateDoc(projectId, docId, dto);
        replaceProject(await api.getProject(projectId));
      },
      patchDocLocal: (projectId, docId, model) => {
        setProjects((cur) =>
          cur.map((p) =>
            p.id !== projectId
              ? p
              : { ...p, updatedAt: new Date().toISOString(), docs: p.docs.map((d) => (d.id === docId ? { ...d, model, updatedAt: new Date().toISOString() } : d)) },
          ),
        );
      },
      deleteDoc: async (projectId, docId) => {
        await api.deleteDoc(projectId, docId);
        replaceProject(await api.getProject(projectId));
      },
    }),
    [projects, loading, error, refresh, replaceProject],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWorkspace outside provider');
  return c;
}
