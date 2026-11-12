import { Body, Controller, Param, Post } from '@nestjs/common';
import { AccessService } from '../auth/access.service.js';
import { AuditService } from '../auth/audit.service.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/token.service.js';
import { type CheckInInput, CheckinsService } from './checkins.service.js';

@Controller()
export class CheckinsController {
  constructor(
    private readonly checkins: CheckinsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records a worker's symptom check-in: text, a recording, or tapped symptoms.
   * Workers have no login of their own yet, so for now this is called on their
   * behalf by their supervisor, HSE or ADMIN. The reply never includes the
   * worker's words.
   */
  @Post('workers/:id/checkins')
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body?: Record<string, unknown>) {
    await this.access.assertWorker(user, id);
    const input: CheckInInput = {
      text: typeof body?.text === 'string' ? body.text : undefined,
      audioBase64: typeof body?.audioBase64 === 'string' ? body.audioBase64 : undefined,
      audioFilename: typeof body?.audioFilename === 'string' ? body.audioFilename : undefined,
      taps: Array.isArray(body?.taps) ? (body.taps as string[]) : undefined,
      replay: body?.replay === true,
    };
    const result = await this.checkins.submit(id, input);
    await this.audit.record(user, 'CHECKIN_WORKER', 'Worker', id, { action: result.action, extractor: result.extractor });
    return result;
  }
}
