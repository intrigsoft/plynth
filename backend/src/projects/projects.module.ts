import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { SandboxController } from './sandbox.controller';
import { DioscController } from './diosc.controller';

@Module({
  controllers: [ProjectsController, SandboxController, DioscController],
})
export class ProjectsModule {}
