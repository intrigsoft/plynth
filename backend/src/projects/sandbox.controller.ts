import { Controller, HttpCode, Post } from '@nestjs/common';
import { StoreService } from '../store/store.service';
import { DeviceId } from '../store/device';

/** "Reset demo data" — restore this device's sandbox to the seed. The no-DB
 *  analogue of wiping your demo workspace (mirrors Cadence's /reset). */
@Controller('sandbox')
export class SandboxController {
  constructor(private readonly store: StoreService) {}

  @Post('reset')
  @HttpCode(204)
  reset(@DeviceId() device: string): void {
    this.store.resetDevice(device);
  }
}
