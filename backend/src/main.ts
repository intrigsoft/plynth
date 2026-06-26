import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { StoreService } from './store/store.service';
import { deviceCookie } from './store/device';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Diagram models can be large; lift the JSON body-size limit.
  app.useBodyParser('json', { limit: '8mb' });
  // Per-device sandbox cookie — runs before all routes (incl. the SPA HTML),
  // so the first visit establishes + seeds the device.
  app.use(deviceCookie(app.get(StoreService)));
  app.setGlobalPrefix('api');
  await app.listen(PORT);
  new Logger('Bootstrap').log(`Plynth on http://localhost:${PORT}`);
}

void bootstrap();
