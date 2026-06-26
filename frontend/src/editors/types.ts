import type { MutableRefObject } from 'react';
import type { DiagramModel } from '@plynth/shared';
import type { ExportFormat } from './engine';

/** The contract every diagram editor implements. The host owns the model
 *  (controlled) and persistence; the editor renders + mutates via `onModel`
 *  and registers an `exportApi` the document menu can invoke. */
export interface EditorProps {
  model: DiagramModel;
  onModel: (m: DiagramModel) => void;
  docName: string;
  projectName: string;
  exportApi: MutableRefObject<((fmt: ExportFormat) => void) | null>;
}
