import type { Project } from '@plynth/shared';

/**
 * Lightweight singleton mirroring the current workspace projects (and their
 * documents) so the app-wide DioscHub assistant — mounted in `AssistantProvider`
 * ABOVE the router, and therefore ABOVE `WorkspaceProvider` — can read them for
 * the composer's `@`-mention provider without depending on React context
 * ordering. Mirrors `editorBridge`: WorkspaceProvider publishes on every change,
 * the assistant reads live whenever the popover needs items.
 */
let projects: Project[] = [];

export const workspaceBridge = {
  /** WorkspaceProvider calls this whenever its `projects` state changes. */
  publish(next: Project[]): void {
    projects = next;
  },
  /** The mention provider reads the current projects (with nested docs). */
  get(): Project[] {
    return projects;
  },
};
