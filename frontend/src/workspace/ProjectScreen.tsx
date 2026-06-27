import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { DiagramDoc, DiagramType } from '@plynth/shared';
import { DIAGRAM_TYPES } from '@plynth/shared';
import { useWorkspace } from './WorkspaceProvider';
import { useAuth } from '../lib/session';
import { AppShell } from './AppShell';
import { DocumentCard } from './components/DocumentCard';
import { ConfirmModal } from './components/ConfirmModal';
import { TextStylesModal } from './components/TextStylesModal';
import { Back, Dots, Folder, Plus, TypeIcon } from '../lib/icons';
import { timeAgo } from '../lib/time';

export function ProjectScreen() {
  const { projectId = '' } = useParams();
  const { project, updateProject, deleteProject, createDoc, deleteDoc, updateDoc } = useWorkspace();
  const { session } = useAuth();
  const nav = useNavigate();
  const p = project(projectId);

  const [name, setName] = useState(p?.name ?? '');
  const [desc, setDesc] = useState(p?.desc ?? '');
  const [picker, setPicker] = useState(false);
  const [projMenu, setProjMenu] = useState(false);
  const [confirmProj, setConfirmProj] = useState(false);
  const [confirmDoc, setConfirmDoc] = useState<DiagramDoc | null>(null);
  const [stylesOpen, setStylesOpen] = useState(false);

  useEffect(() => { if (p) { setName(p.name); setDesc(p.desc); } }, [p?.id]); // eslint-disable-line

  if (!p) {
    return (
      <AppShell crumbs={[{ label: 'Projects', to: '/' }, { label: 'Not found', active: true }]}>
        <div className="dot-surface" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-3)' }}>Project not found.</div>
      </AppShell>
    );
  }

  const pick = async (type: DiagramType) => {
    setPicker(false);
    const meta = DIAGRAM_TYPES.find((t) => t.id === type)!;
    const doc = await createDoc(p.id, { name: `Untitled ${meta.label}`, type });
    nav(`/p/${p.id}/d/${doc.id}`);
  };

  return (
    <AppShell crumbs={[{ label: 'Projects', to: '/' }, { label: p.name, active: true }]}>
      <div className="dot-surface scroll" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '34px 32px 60px' }}>
          <button className="btn--ghost" onClick={() => nav('/')} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--muted-2)', fontSize: 13, marginBottom: 18, padding: 0 }}>
            <Back size={16} /> All projects
          </button>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ width: 52, height: 52, borderRadius: 13, background: p.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Folder size={26} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name !== p.name && updateProject(p.id, { name: name.trim() })}
                style={{ width: '100%', fontSize: 26, fontWeight: 800, border: 'none', outline: 'none', background: 'transparent', letterSpacing: '-0.5px' }}
              />
              <div style={{ fontSize: 13, color: 'var(--muted-3)', margin: '2px 0 8px' }}>
                {p.docs.length} document{p.docs.length === 1 ? '' : 's'}{session && ` · owned by ${session.name}`} · edited {timeAgo(p.updatedAt)}
              </div>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onBlur={() => desc !== p.desc && updateProject(p.id, { desc })}
                placeholder="Add a description for this project…"
                rows={1}
                style={{ width: '100%', fontSize: 13.5, color: 'var(--muted-2)', border: 'none', outline: 'none', resize: 'none', background: 'transparent' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <button
                className="btn"
                style={{ padding: 9 }}
                title="Text styles"
                aria-label="Text styles"
                data-testid="text-styles-button"
                onClick={() => setStylesOpen(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M5 7V5h14v2M9 19h6M12 5v14" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div style={{ position: 'relative' }}>
                <button className="btn" style={{ padding: 9 }} onClick={() => setProjMenu((v) => !v)}><Dots size={18} /></button>
                {projMenu && (
                  <>
                    <div className="backdrop" onClick={() => setProjMenu(false)} />
                    <div className="pop" style={{ right: 0, top: 42, width: 168 }} onClick={(e) => e.stopPropagation()}>
                      <button className="pop-item pop-item--danger" onClick={() => { setProjMenu(false); setConfirmProj(true); }}>Delete project</button>
                    </div>
                  </>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <button className="btn btn--primary" onClick={() => setPicker((v) => !v)}><Plus size={16} color="#fff" /> New document</button>
                {picker && (
                  <>
                    <div className="backdrop" onClick={() => setPicker(false)} />
                    <div className="pop" style={{ right: 0, top: 46, width: 268, padding: 7 }} onClick={(e) => e.stopPropagation()}>
                      <div className="label-mono" style={{ fontSize: 10, padding: '5px 8px 7px', color: 'var(--faint)' }}>Diagram type</div>
                      {DIAGRAM_TYPES.map((t) => (
                        <button key={t.id} className="pop-item" onClick={() => pick(t.id)} style={{ padding: '8px 9px' }}>
                          <span style={{ width: 34, height: 34, borderRadius: 9, background: t.accent + '12', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <TypeIcon type={t.id} size={18} color={t.accent} />
                          </span>
                          <span style={{ textAlign: 'left' }}>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                            <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)' }}>{t.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* documents */}
          <div style={{ marginTop: 26 }}>
            {p.docs.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(238px,1fr))', gap: 18 }}>
                {p.docs.map((d) => (
                  <DocumentCard
                    key={d.id}
                    doc={d}
                    onOpen={() => nav(`/p/${p.id}/d/${d.id}`)}
                    onRename={(nm) => updateDoc(p.id, d.id, { name: nm })}
                    onDescribe={(ds) => updateDoc(p.id, d.id, { desc: ds })}
                    onDelete={() => setConfirmDoc(d)}
                  />
                ))}
              </div>
            ) : (
              <div style={{ border: '1.5px dashed var(--border-hover)', borderRadius: 16, padding: '46px 20px', textAlign: 'center', color: 'var(--muted-3)' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>No documents yet</div>
                <div style={{ fontSize: 13.5, margin: '6px 0 16px' }}>Create your first diagram in this project.</div>
                <button className="btn btn--primary" onClick={() => setPicker(true)} style={{ margin: '0 auto' }}><Plus size={16} color="#fff" /> New document</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmProj && (
        <ConfirmModal title={`Delete "${p.name}"?`} body="This project and all of its documents will be permanently deleted. This can't be undone."
          onCancel={() => setConfirmProj(false)} onConfirm={async () => { await deleteProject(p.id); nav('/'); }} />
      )}
      {confirmDoc && (
        <ConfirmModal title={`Delete "${confirmDoc.name}"?`} body="This document and its contents will be permanently deleted. This can't be undone."
          onCancel={() => setConfirmDoc(null)} onConfirm={async () => { await deleteDoc(p.id, confirmDoc.id); setConfirmDoc(null); }} />
      )}
      {stylesOpen && <TextStylesModal onClose={() => setStylesOpen(false)} />}
    </AppShell>
  );
}
