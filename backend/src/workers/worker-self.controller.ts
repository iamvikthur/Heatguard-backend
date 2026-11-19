import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuditService } from '../auth/audit.service.js';
import { CurrentWorker, WorkerAuth } from '../auth/auth.decorators.js';
import type { AuthWorker } from '../auth/token.service.js';
import { type CheckInInput, CheckinsService } from '../checkins/checkins.service.js';
import { CONSENT_SCOPES, type ConsentScope, WorkersService } from './workers.service.js';

/**
 * What a worker can do with their own sign-in link: read their schedule, send
 * a check-in and change their own consent. The worker is taken from the link,
 * never from the URL, so one link reaches one worker's data and no other's.
 */
@WorkerAuth()
@Controller('worker/me')
export class WorkerSelfController {
  constructor(
    private readonly workers: WorkersService,
    private readonly checkins: CheckinsService,
    private readonly audit: AuditService,
  ) {}

  @Get('today')
  today(@CurrentWorker() worker: AuthWorker, @Query('replay') replay?: string) {
    return this.workers.today(worker.id, replay === 'true');
  }

  @Post('checkins')
  async checkIn(@CurrentWorker() worker: AuthWorker, @Body() body?: Record<string, unknown>) {
    const input: CheckInInput = {
      text: typeof body?.text === 'string' ? body.text : undefined,
      audioBase64: typeof body?.audioBase64 === 'string' ? body.audioBase64 : undefined,
      audioFilename: typeof body?.audioFilename === 'string' ? body.audioFilename : undefined,
      taps: Array.isArray(body?.taps) ? (body.taps as string[]) : undefined,
      replay: body?.replay === true,
    };
    const result = await this.checkins.submit(worker.id, input);
    await this.audit.recordWorker(worker.id, 'CHECKIN_SELF', { action: result.action });
    return result;
  }

  @Post('consents')
  async setConsent(@CurrentWorker() worker: AuthWorker, @Body() body?: { scope?: unknown; granted?: unknown }) {
    const scope = body?.scope;
    if (typeof scope !== 'string' || !CONSENT_SCOPES.includes(scope as ConsentScope)) {
      throw new BadRequestException(`scope must be one of: ${CONSENT_SCOPES.join(', ')}`);
    }
    if (typeof body?.granted !== 'boolean') throw new BadRequestException('granted must be true or false');
    await this.audit.recordWorker(worker.id, body.granted ? 'GRANT_CONSENT_SELF' : 'WITHDRAW_CONSENT_SELF', { scope });
    return this.workers.setConsent(worker.id, scope as ConsentScope, body.granted);
  }
}
