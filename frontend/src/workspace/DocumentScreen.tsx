import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DIAGRAM_TYPE_MAP } from '@plynth/shared';
import { useWorkspace } from './WorkspaceProvider';
import { AppShell } from './AppShell';
import { EditorHost } from '../editors/EditorHost';
import type { ExportFormat } from '../editors/engine';
import { Check, Menu, Save } from '../lib/icons';
import { clockLabel } from '../lib/time';

export function DocumentScreen() {
  const { projectId = '', docId = '' } = useParams();
  const { project, updateDoc } = useWorkspace();
  const p = project(projectId);
  const doc = p?.docs.find((d) => d.id === docId);
  const exportApi = useRef<((fmt: ExportFormat) => void) | null>(null);

  const [menu, setMenu] = useState(false);
  const [saved, setSaved] = useState('');

  if (!p || !doc) {
    return (
      <AppShell crumbs={[{ label: 'Projects', to: '/' }, { label: 'Not found', active: true }]}>
        <div className="dot-surface" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-3)' }}>Document not found.</div>
      </AppShell>
    );
  }

  const meta = DIAGRAM_TYPE_MAP[doc.type];

  const save = async () => {
    await updateDoc(p.id, doc.id, { model: doc.model });
    setSaved(clockLabel());
    setTimeout(() => setSaved(''), 2200);
  };

  const docActions = (
    <div style={{ position: 'relative', marginLeft: 4 }}>
      <button onClick={() => setMenu((v) => !v)} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: '#1f2630', color: '#cdd5e0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Menu size={17} />
      </button>
      {menu && (
        <>
          <div className="backdrop" onClick={() => setMenu(false)} />
          <div className="pop" style={{ left: 0, top: 42, width: 212 }} onClick={(e) => e.stopPropagation()}>
            <button className="pop-item" onClick={() => { setMenu(false); void save(); }}>
              {saved ? <Check size={16} color="var(--teal)" /> : <Save size={16} color="var(--primary)" />}
              <span style={{ flex: 1 }}>{saved ? 'Saved' : 'Save'}</span>
              {saved && <span style={{ fontSize: 11, color: 'var(--muted-4)' }}>{saved}</span>}
            </button>
            <div style={{ height: 1, background: 'var(--border)', margin: '5px 0' }} />
            <div className="label-mono" style={{ fontSize: 10, padding: '3px 10px 5px', color: 'var(--faint)' }}>Export as</div>
            {(['PNG', 'JPG', 'SVG', 'XML'] as const).map((f) => (
              <button key={f} className="pop-item" onClick={() => { setMenu(false); exportApi.current?.(f.toLowerCase() as ExportFormat); }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: meta.accent, background: meta.accent + '14', borderRadius: 5, padding: '3px 6px' }}>{f}</span>
                {f === 'PNG' ? 'Raster image' : f === 'JPG' ? 'Flat image' : f === 'SVG' ? 'Vector' : 'Re-importable'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <AppShell
      crumbs={[
        { label: 'Projects', to: '/' },
        { label: p.name, to: `/p/${p.id}` },
        { label: doc.name, active: true, badge: { text: meta.label, color: meta.accent } },
      ]}
      docActions={docActions}
      suppressAssistant
    >
      <EditorHost key={doc.id} projectId={p.id} doc={doc} projectName={p.name} exportApi={exportApi} />
    </AppShell>
  );
}
