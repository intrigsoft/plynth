import { useState } from 'react';
import type { DiagramDoc } from '@plynth/shared';
import { DIAGRAM_TYPE_MAP } from '@plynth/shared';
import { Dots, TypeIcon } from '../../lib/icons';
import { timeAgo } from '../../lib/time';
import { Thumbnail } from './Thumbnail';

export function DocumentCard({
  doc,
  onOpen,
  onRename,
  onDescribe,
  onDelete,
}: {
  doc: DiagramDoc;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDescribe: (desc: string) => void;
  onDelete: () => void;
}) {
  const meta = DIAGRAM_TYPE_MAP[doc.type];
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.name);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descVal, setDescVal] = useState(doc.desc ?? '');

  const commit = () => {
    setEditing(false);
    const v = name.trim();
    if (v && v !== doc.name) onRename(v);
    else setName(doc.name);
  };
  const startDesc = () => { setMenu(false); setDescVal(doc.desc ?? ''); setEditingDesc(true); };
  const commitDesc = () => {
    setEditingDesc(false);
    const v = descVal.trim();
    if (v !== (doc.desc ?? '')) onDescribe(v);
  };

  return (
    <div className="card card--hover" style={{ overflow: 'hidden', cursor: 'pointer', position: 'relative', zIndex: menu ? 60 : undefined }} onClick={() => !editing && !editingDesc && onOpen()}>
      {/* thumbnail */}
      <div style={{ height: 138, background: '#f7f9fb', borderBottom: '1px solid #eef1f5', position: 'relative', backgroundImage: 'radial-gradient(#e2e7ee 1px, transparent 1px)', backgroundSize: '13px 13px' }}>
        <Thumbnail model={doc.model} type={doc.type} />
        <span style={{ position: 'absolute', top: 9, right: 9, fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 600, color: meta.accent, background: '#fff', border: `1px solid ${meta.accent}30`, borderRadius: 5, padding: '2px 6px' }}>
          {meta.label}
        </span>
      </div>

      {/* body */}
      <div style={{ padding: '12px 14px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <input
                ref={(el) => { if (el) { el.focus(); el.select(); } }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setName(doc.name); } }}
                onBlur={commit}
                style={{ width: '100%', fontSize: 14, fontWeight: 700, border: 'none', outline: '2px solid var(--primary)', borderRadius: 3, padding: '1px 3px' }}
              />
            ) : (
              <div
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
                style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {doc.name}
              </div>
            )}
            {editingDesc ? (
              <input
                ref={(el) => { if (el) { el.focus(); el.select(); } }}
                value={descVal}
                onChange={(e) => setDescVal(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Enter') commitDesc(); if (e.key === 'Escape') { setEditingDesc(false); setDescVal(doc.desc ?? ''); } }}
                onBlur={commitDesc}
                placeholder="Add a description"
                style={{ width: '100%', fontSize: 12, marginTop: 3, border: 'none', outline: '2px solid var(--primary)', borderRadius: 3, padding: '1px 3px' }}
              />
            ) : (
              <div
                onClick={(e) => { e.stopPropagation(); startDesc(); }}
                title="Edit description"
                style={{ fontSize: 12, color: doc.desc ? 'var(--muted-2)' : 'var(--faint)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'text' }}
              >
                {doc.desc || 'Add a description'}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--muted-4)', marginTop: 6 }}>Edited {timeAgo(doc.updatedAt)}</div>
          </div>
          <TypeIcon type={doc.type} size={17} color={meta.accent} />
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
            <button className="btn--ghost" style={{ border: 'none', background: 'none', color: 'var(--muted-4)', padding: 3 }} onClick={() => setMenu((v) => !v)}>
              <Dots size={17} />
            </button>
            {menu && (
              <>
                <div className="backdrop" onClick={() => setMenu(false)} />
                <div className="pop" style={{ right: 0, top: 28, width: 180 }} onClick={(e) => e.stopPropagation()}>
                  <button className="pop-item" onClick={() => { setMenu(false); setEditing(true); }}>Rename</button>
                  <button className="pop-item" onClick={startDesc}>Edit description</button>
                  <button className="pop-item pop-item--danger" onClick={() => { setMenu(false); onDelete(); }}>Delete document</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
