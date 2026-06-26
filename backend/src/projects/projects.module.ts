import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { SandboxController } from './sandbox.controller';

@Module({
  controllers: [ProjectsController, SandboxController],
})
export class ProjectsModule {}
