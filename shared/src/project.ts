import { DiagramType } from './diagram-types';
import { DiagramModel } from './models';

/** A user session (the prototype persists this in localStorage). */
export interface SessionUser {
  name: string;
  email: string;
  initials: string;
  color: string;
}

/** One diagram inside a project. `model` is the structured source of truth. */
export interface DiagramDoc {
  id: string;
  name: string;
  type: DiagramType;
  desc?: string;
  updatedAt: string; // ISO timestamp
  model: DiagramModel;
}

/** A project groups documents. */
export interface Project {
  id: string;
  name: string;
  desc: string;
  color: string;
  updatedAt: string; // ISO timestamp
  docs: DiagramDoc[];
}

/* ---- API DTOs ----------------------------------------------------------- */

export interface CreateProjectDto {
  name: string;
  desc?: string;
  color?: string;
}

export interface UpdateProjectDto {
  name?: string;
  desc?: string;
  color?: string;
}

export interface CreateDocumentDto {
  name: string;
  type: DiagramType;
  desc?: string;
  /** Optional initial model; if omitted the server seeds an empty one. */
  model?: DiagramModel;
}

export interface UpdateDocumentDto {
  name?: string;
  desc?: string;
  model?: DiagramModel;
}
