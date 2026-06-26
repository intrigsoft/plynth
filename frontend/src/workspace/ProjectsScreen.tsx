import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@plynth/shared';
import { useWorkspace } from './WorkspaceProvider';
import { useAuth, firstName } from '../lib/session';
import { AppShell } from './AppShell';
import { ProjectCard } from './components/ProjectCard';
import { ConfirmModal } from './components/ConfirmModal';
import { Plus } from '../lib/icons';

export function ProjectsScreen() {
  const { projects, loading, error, createProject, deleteProject } = useWorkspace();
  const { session } = useAuth();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState<Project | null>(null);

  const newProject = async () => {
    const p = await createProject({ name: 'Untitled project' });
    nav(`/p/${p.id}`);
  };

  return (
    <AppShell crumbs={[{ label: 'Projects', active: true }]}>
      <div className="dot-surface scroll" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '38px 32px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.6px', margin: 0 }}>Projects</h1>
              <div style={{ fontSize: 13.5, color: 'var(--muted-3)', marginTop: 4 }}>
                {projects.length} project{projects.length === 1 ? '' : 's'}
                {session && ` · signed in as ${firstName(session)}`}
              </div>
            </div>
            <button className="btn btn--primary" onClick={newProject}>
              <Plus size={16} color="#fff" /> New project
            </button>
          </div>

          {loading && <div style={{ color: 'var(--muted-3)' }}>Loading…</div>}
          {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}

          {!loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(216px,1fr))', gap: 18 }}>
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => nav(`/p/${p.id}`)} onDelete={() => setConfirm(p)} />
              ))}
              <button
                onClick={newProject}
                style={{ minHeight: 190, border: '1.5px dashed var(--border-hover)', borderRadius: 13, background: 'transparent', color: 'var(--muted-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13.5 }}
              >
                <Plus size={22} color="var(--muted-4)" />
                New project
              </button>
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={`Delete "${confirm.name}"?`}
          body="This project and all of its documents will be permanently deleted. This can't be undone."
          onCancel={() => setConfirm(null)}
          onConfirm={async () => { await deleteProject(confirm.id); setConfirm(null); }}
        />
      )}
    </AppShell>
  );
}
