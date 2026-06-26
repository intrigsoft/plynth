/* =============================================================================
 *  Per-device sandbox store — the in-memory replacement for a database.
 *
 *  Each browser gets an opaque device id (cookie) mapped to its own isolated
 *  workspace (a fresh deep-clone of the seed). Mirrors the Cadence / Northwind
 *  samples: per-cookie isolation, TTL-idle eviction + a hard device cap so a
 *  public sandbox can't leak memory. No persistence layer by design — a process
 *  restart wipes every sandbox back to the seed.
 * ===========================================================================*/

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateDocumentDto,
  CreateProjectDto,
  DiagramDoc,
  Project,
  UpdateDocumentDto,
  UpdateProjectDto,
  emptyModel,
} from '@plynth/shared';
import { randomUUID } from 'node:crypto';
import { SEED_PROJECTS } from './seed-data';

interface WorkspaceState {
  projects: Project[];
  createdAt: number;
  lastSeen: number;
}

const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // evict a sandbox after 2h idle
const MAX_DEVICES = 2000; // hard cap; evict least-recently-seen beyond this
const PROJECT_COLORS = ['#3a5bff', '#0e9488', '#a21caf', '#c2410c', '#4f46e5', '#15803d', '#0891b2'];

@Injectable()
export class StoreService {
  private readonly devices = new Map<string, WorkspaceState>();

  /* ---- device lifecycle ------------------------------------------------ */

  private freshState(): WorkspaceState {
    const t = Date.now();
    return { projects: structuredClone(SEED_PROJECTS), createdAt: t, lastSeen: t };
  }

  /** Resolve the sandbox for a device cookie, minting a fresh (seeded) one if
   *  the cookie is missing or unknown (evicted / server restart). */
  getOrCreateDevice(cookieId: string | undefined): { deviceId: string; isNew: boolean } {
    this.evictStale();
    if (cookieId) {
      const existing = this.devices.get(cookieId);
      if (existing) {
        existing.lastSeen = Date.now();
        return { deviceId: cookieId, isNew: false };
      }
    }
    const deviceId = randomUUID();
    this.devices.set(deviceId, this.freshState());
    this.enforceCap();
    return { deviceId, isNew: true };
  }

  /** Restore a device's sandbox to the seed (the "Reset demo data" affordance). */
  resetDevice(deviceId: string): void {
    this.devices.set(deviceId, this.freshState());
  }

  private state(deviceId: string): WorkspaceState {
    let s = this.devices.get(deviceId);
    if (!s) {
      s = this.freshState();
      this.devices.set(deviceId, s);
    }
    s.lastSeen = Date.now();
    return s;
  }

  private evictStale(): void {
    const cutoff = Date.now() - IDLE_TTL_MS;
    for (const [id, s] of this.devices) if (s.lastSeen < cutoff) this.devices.delete(id);
  }

  private enforceCap(): void {
    if (this.devices.size <= MAX_DEVICES) return;
    const byOldest = [...this.devices.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (const [id] of byOldest) {
      if (this.devices.size <= MAX_DEVICES) break;
      this.devices.delete(id);
    }
  }

  /* ---- helpers --------------------------------------------------------- */

  private now(): string {
    return new Date().toISOString();
  }
  private id(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  }

  /* ---- projects (device-scoped) ---------------------------------------- */

  listProjects(deviceId: string): Project[] {
    return this.state(deviceId).projects;
  }

  getProject(deviceId: string, id: string): Project {
    const p = this.state(deviceId).projects.find((x) => x.id === id);
    if (!p) throw new NotFoundException(`project '${id}' not found`);
    return p;
  }

  createProject(deviceId: string, dto: CreateProjectDto): Project {
    const st = this.state(deviceId);
    const project: Project = {
      id: this.id('p'),
      name: dto.name?.trim() || 'Untitled project',
      desc: dto.desc ?? '',
      color: dto.color ?? PROJECT_COLORS[st.projects.length % PROJECT_COLORS.length],
      updatedAt: this.now(),
      docs: [],
    };
    st.projects.unshift(project);
    return project;
  }

  updateProject(deviceId: string, id: string, dto: UpdateProjectDto): Project {
    const p = this.getProject(deviceId, id);
    if (dto.name !== undefined) p.name = dto.name;
    if (dto.desc !== undefined) p.desc = dto.desc;
    if (dto.color !== undefined) p.color = dto.color;
    p.updatedAt = this.now();
    return p;
  }

  deleteProject(deviceId: string, id: string): void {
    const st = this.state(deviceId);
    const i = st.projects.findIndex((x) => x.id === id);
    if (i < 0) throw new NotFoundException(`project '${id}' not found`);
    st.projects.splice(i, 1);
  }

  /* ---- documents (device-scoped) --------------------------------------- */

  getDoc(deviceId: string, projectId: string, docId: string): DiagramDoc {
    const d = this.getProject(deviceId, projectId).docs.find((x) => x.id === docId);
    if (!d) throw new NotFoundException(`document '${docId}' not found`);
    return d;
  }

  createDoc(deviceId: string, projectId: string, dto: CreateDocumentDto): DiagramDoc {
    const p = this.getProject(deviceId, projectId);
    const doc: DiagramDoc = {
      id: this.id('d'),
      name: dto.name?.trim() || 'Untitled diagram',
      type: dto.type,
      desc: dto.desc ?? '',
      updatedAt: this.now(),
      model: dto.model ?? emptyModel(dto.type),
    };
    p.docs.unshift(doc);
    p.updatedAt = this.now();
    return doc;
  }

  updateDoc(deviceId: string, projectId: string, docId: string, dto: UpdateDocumentDto): DiagramDoc {
    const p = this.getProject(deviceId, projectId);
    const d = this.getDoc(deviceId, projectId, docId);
    if (dto.name !== undefined) d.name = dto.name;
    if (dto.desc !== undefined) d.desc = dto.desc;
    if (dto.model !== undefined) d.model = dto.model;
    d.updatedAt = this.now();
    p.updatedAt = this.now();
    return d;
  }

  deleteDoc(deviceId: string, projectId: string, docId: string): void {
    const p = this.getProject(deviceId, projectId);
    const i = p.docs.findIndex((x) => x.id === docId);
    if (i < 0) throw new NotFoundException(`document '${docId}' not found`);
    p.docs.splice(i, 1);
    p.updatedAt = this.now();
  }
}
