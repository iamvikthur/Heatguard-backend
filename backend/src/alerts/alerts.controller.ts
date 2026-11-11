import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AccessService } from '../auth/access.service.js';
import { AuditService } from '../auth/audit.service.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/token.service.js';
import { AlertsService } from './alerts.service.js';

/**
 * Every route checks that the crew or worker is in the caller's scope
 * (AccessService). Routes that read or act on one worker's data are audited.
 * Workers have no login of their own yet, so a worker's inbox is reachable
 * only by their supervisor and by HSE or ADMIN.
 */
@Controller()
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('crews/:id/alerts')
  async crewAlerts(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('replay') replay?: string) {
    await this.access.assertCrew(user, id);
    return this.alerts.crewAlerts(id, replay === 'true');
  }

  @Get('crews/:id/workers')
  async crewWorkers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertCrew(user, id);
    return this.alerts.crewWorkers(id);
  }

  @Get('crews/:id/needs-check')
  async needsCheck(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertCrew(user, id);
    return this.alerts.needsCheck(id);
  }

  @Get('workers/:id/alerts')
  async workerAlerts(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('replay') replay?: string) {
    await this.access.assertWorker(user, id);
    await this.audit.record(user, 'READ_WORKER_ALERTS', 'Worker', id);
    return this.alerts.workerAlerts(id, replay === 'true');
  }

  @Post('alerts/:id/ack')
  async acknowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertAlert(user, id);
    await this.audit.record(user, 'ACK_ALERT', 'Alert', id);
    return this.alerts.acknowledge(id);
  }

  /** Temporary entry point for the emergency path until symptom check-ins exist. */
  @Post('workers/:id/escalate')
  async escalate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body?: { symptoms?: unknown }) {
    await this.access.assertWorker(user, id);
    const symptoms = Array.isArray(body?.symptoms)
      ? body.symptoms.filter((s): s is string => typeof s === 'string').slice(0, 10)
      : [];
    await this.audit.record(user, 'ESCALATE_WORKER', 'Worker', id, { symptomCount: symptoms.length });
    return this.alerts.escalate(id, symptoms);
  }
}
