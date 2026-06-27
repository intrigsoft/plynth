import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateDocumentDto,
  CreateProjectDto,
  DiagramDoc,
  Project,
  UpdateDocumentDto,
  UpdateProjectDto,
} from '@plynth/shared';
import { StoreService } from '../store/store.service';
import { DeviceId } from '../store/device';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly store: StoreService) {}

  /* ---- search (declared before ":id" so the literals aren't shadowed) --- */

  @Get('search')
  searchProjects(@DeviceId() device: string, @Query('q') q = '') {
    return this.store.searchProjects(device, q);
  }

  @Get('documents/search')
  searchDocuments(@DeviceId() device: string, @Query('q') q = '', @Query('projectId') projectId?: string) {
    return this.store.searchDocuments(device, q, projectId);
  }

  @Get()
  list(@DeviceId() device: string): Project[] {
    return this.store.listProjects(device);
  }

  @Post()
  create(@DeviceId() device: string, @Body() dto: CreateProjectDto): Project {
    return this.store.createProject(device, dto);
  }

  @Get(':id')
  get(@DeviceId() device: string, @Param('id') id: string): Project {
    return this.store.getProject(device, id);
  }

  @Patch(':id')
  update(@DeviceId() device: string, @Param('id') id: string, @Body() dto: UpdateProjectDto): Project {
    return this.store.updateProject(device, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@DeviceId() device: string, @Param('id') id: string): void {
    this.store.deleteProject(device, id);
  }

  /* ---- nested documents ------------------------------------------------ */

  @Post(':id/documents')
  createDoc(@DeviceId() device: string, @Param('id') id: string, @Body() dto: CreateDocumentDto): DiagramDoc {
    return this.store.createDoc(device, id, dto);
  }

  @Get(':id/documents/:docId')
  getDoc(@DeviceId() device: string, @Param('id') id: string, @Param('docId') docId: string): DiagramDoc {
    return this.store.getDoc(device, id, docId);
  }

  @Patch(':id/documents/:docId')
  updateDoc(
    @DeviceId() device: string,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: UpdateDocumentDto,
  ): DiagramDoc {
    return this.store.updateDoc(device, id, docId, dto);
  }

  @Delete(':id/documents/:docId')
  @HttpCode(204)
  removeDoc(@DeviceId() device: string, @Param('id') id: string, @Param('docId') docId: string): void {
    this.store.deleteDoc(device, id, docId);
  }
}
