import { useState } from 'react';
import type { Project } from '@plynth/shared';
import { DIAGRAM_TYPE_MAP } from '@plynth/shared';
import { Avatar, Dots, Folder } from '../../lib/icons';
import { useAuth } from '../../lib/session';
import { timeAgo } from '../../lib/time';

export function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { session } = useAuth();
  const [menu, setMenu] = useState(false);

  // distinct type → count
  const counts = new Map<string, number>();
  for (const d of project.docs) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);

  return (
    <div className="card card--hover" style={{ padding: 18, position: 'relative', cursor: 'pointer' }} onClick={onOpen}>
      <div style={{ position: 'absolute', top: 12, right: 12 }} onClick={(e) => e.stopPropagation()}>
        <button className="btn--ghost" style={{ border: 'none', background: 'none', color: 'var(--muted-4)', padding: 4 }} onClick={() => setMenu((v) => !v)}>
          <Dots size={18} />
        </button>
        {menu && (
          <>
            <div className="backdrop" onClick={() => setMenu(false)} />
            <div className="pop" style={{ right: 0, top: 30, width: 168 }} onClick={(e) => e.stopPropagation()}>
              <button className="pop-item pop-item--danger" onClick={() => { setMenu(false); onDelete(); }}>Delete project</button>
            </div>
          </>
        )}
      </div>

      <div style={{ width: 42, height: 42, borderRadius: 11, background: project.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Folder size={22} color="#fff" />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted-3)', marginTop: 2 }}>
        {project.docs.length} document{project.docs.length === 1 ? '' : 's'}
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted-2)', marginTop: 9, minHeight: 38, lineHeight: 1.45 }}>
        {project.desc || <span style={{ color: 'var(--faint)' }}>No description yet.</span>}
      </div>

      {counts.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {[...counts].map(([t, n]) => {
            const meta = DIAGRAM_TYPE_MAP[t as keyof typeof DIAGRAM_TYPE_MAP];
            return (
              <span key={t} style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: meta.accent, background: meta.accent + '14', border: `1px solid ${meta.accent}30`, borderRadius: 6, padding: '2px 6px' }}>
                {meta.label} · {n}
              </span>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--tint-3)', marginTop: 13, paddingTop: 11 }}>
        <span style={{ fontSize: 11.5, color: 'var(--muted-4)' }}>Edited {timeAgo(project.updatedAt)}</span>
        {session && <Avatar user={session} size={26} />}
      </div>
    </div>
  );
}
