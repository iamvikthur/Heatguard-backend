import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AccessService } from '../auth/access.service.js';
import { AuditService } from '../auth/audit.service.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/token.service.js';
import { CONSENT_SCOPES, type ConsentScope, WorkersService } from './workers.service.js';

/**
 * The worker's own view. Workers have no login yet, so these routes are
 * reached by their supervisor, HSE or ADMIN, and every read of an individual
 * worker's data is audited.
 */
@Controller('workers/:id')
export class WorkersController {
  constructor(
    private readonly workers: WorkersService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('today')
  async today(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('replay') replay?: string) {
    await this.access.assertWorker(user, id);
    await this.audit.record(user, 'READ_WORKER_TODAY', 'Worker', id);
    return this.workers.today(id, replay === 'true');
  }

  /**
   * Issues a sign-in link for this worker and retires any earlier one. The
   * link is shown once; it is not stored anywhere it can be read back.
   */
  @Post('access-link')
  async issueAccessLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertWorker(user, id);
    await this.audit.record(user, 'ISSUE_WORKER_LINK', 'Worker', id);
    return this.workers.issueAccessLink(id, process.env.WEB_BASE_URL ?? 'http://localhost:3000');
  }

  @Post('access-link/revoke')
  async revokeAccessLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertWorker(user, id);
    await this.audit.record(user, 'REVOKE_WORKER_LINK', 'Worker', id);
    return this.workers.revokeAccessLinks(id);
  }

  @Post('consents')
  async setConsent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body?: { scope?: unknown; granted?: unknown },
  ) {
    await this.access.assertWorker(user, id);
    const scope = body?.scope;
    if (typeof scope !== 'string' || !CONSENT_SCOPES.includes(scope as ConsentScope)) {
      throw new BadRequestException(`scope must be one of: ${CONSENT_SCOPES.join(', ')}`);
    }
    if (typeof body?.granted !== 'boolean') throw new BadRequestException('granted must be true or false');
    await this.audit.record(user, body.granted ? 'GRANT_CONSENT' : 'WITHDRAW_CONSENT', 'Worker', id, { scope });
    return this.workers.setConsent(id, scope as ConsentScope, body.granted);
  }
}
