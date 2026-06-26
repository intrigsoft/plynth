import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { StoreModule } from './store/store.module';
import { ProjectsModule } from './projects/projects.module';

// In the built layout (backend/dist/app.module.js) this resolves to the
// frontend's production build at <repo|app>/frontend/dist. When present (prod /
// single-service deploy) the API also serves the SPA; in local dev Vite serves
// the frontend, so this is simply skipped.
const STATIC_ROOT = process.env.PLYNTH_STATIC ?? join(__dirname, '..', '..', 'frontend', 'dist');

@Module({
  imports: [
    ...(existsSync(STATIC_ROOT)
      ? [
          ServeStaticModule.forRoot({
            rootPath: STATIC_ROOT,
            exclude: ['/api/(.*)'], // API routes fall through to the controllers
          }),
        ]
      : []),
    StoreModule,
    ProjectsModule,
  ],
})
export class AppModule {}
