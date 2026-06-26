import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { DiagramDoc, DiagramModel } from '@plynth/shared';
import { DIAGRAM_TYPE_MAP } from '@plynth/shared';
import { api } from '../lib/api';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { TypeIcon } from '../lib/icons';
import type { ExportFormat } from './engine';
import { ErdEditor } from './erd/ErdEditor';
import { ClassEditor } from './class/ClassEditor';
import { DeploymentEditor } from './deployment/DeploymentEditor';
import { ComponentEditor } from './component/ComponentEditor';
import { UseCaseEditor } from './usecase/UseCaseEditor';
import { FlowchartEditor } from './flowchart/FlowchartEditor';
import { SequenceEditor } from './sequence/SequenceEditor';

export function EditorHost({
  projectId,
  doc,
  projectName,
  exportApi,
}: {
  projectId: string;
  doc: DiagramDoc;
  projectName: string;
  exportApi: MutableRefObject<((fmt: ExportFormat) => void) | null>;
}) {
  const { patchDocLocal } = useWorkspace();
  const [model, setModel] = useState<DiagramModel>(doc.model);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // re-init when switching documents
  useEffect(() => { setModel(doc.model); }, [doc.id]); // eslint-disable-line

  const onModel = useCallback((m: DiagramModel) => {
    setModel(m);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.updateDoc(projectId, doc.id, { model: m }).catch(() => {});
      patchDocLocal(projectId, doc.id, m);
    }, 600);
  }, [projectId, doc.id, patchDocLocal]);

  const common = { model, onModel, docName: doc.name, projectName, exportApi };

  switch (doc.type) {
    case 'erd':
      return <ErdEditor key={doc.id} {...common} />;
    case 'class':
      return <ClassEditor key={doc.id} {...common} />;
    case 'deployment':
      return <DeploymentEditor key={doc.id} {...common} />;
    case 'component':
      return <ComponentEditor key={doc.id} {...common} />;
    case 'usecase':
      return <UseCaseEditor key={doc.id} {...common} />;
    case 'flowchart':
      return <FlowchartEditor key={doc.id} {...common} />;
    case 'sequence':
      return <SequenceEditor key={doc.id} {...common} />;
    default:
      return <ComingSoon doc={doc} />;
  }
}

function ComingSoon({ doc }: { doc: DiagramDoc }) {
  const meta = DIAGRAM_TYPE_MAP[doc.type];
  return (
    <div className="dot-surface" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <span style={{ width: 56, height: 56, borderRadius: 14, background: meta.accent + '14', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <TypeIcon type={doc.type} size={28} color={meta.accent} />
        </span>
        <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 8px' }}>{doc.name}</h2>
        <p style={{ fontSize: 13.5, color: 'var(--muted-2)', lineHeight: 1.55 }}>The {meta.label} editor is being wired up next.</p>
      </div>
    </div>
  );
}
