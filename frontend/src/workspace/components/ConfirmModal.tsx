import { Trash } from '../../lib/icons';

export function ConfirmModal({
  title,
  body,
  confirmLabel = 'Delete',
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 382, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)' }}>
          <Trash size={20} />
        </div>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: '14px 0 6px' }}>{title}</h2>
        <p style={{ fontSize: 13.5, color: 'var(--muted-2)', margin: 0, lineHeight: 1.5 }}>{body}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 20 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
