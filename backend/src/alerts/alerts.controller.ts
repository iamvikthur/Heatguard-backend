import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service.js';

// TODO(auth): open until the auth module and role guard land. Worker inboxes and
// the escalate route in particular must be restricted.
@Controller()
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('crews/:id/alerts')
  crewAlerts(@Param('id') id: string, @Query('replay') replay?: string) {
    return this.alerts.crewAlerts(id, replay === 'true');
  }

  @Get('crews/:id/workers')
  crewWorkers(@Param('id') id: string) {
    return this.alerts.crewWorkers(id);
  }

  @Get('crews/:id/needs-check')
  needsCheck(@Param('id') id: string) {
    return this.alerts.needsCheck(id);
  }

  @Get('workers/:id/alerts')
  workerAlerts(@Param('id') id: string, @Query('replay') replay?: string) {
    return this.alerts.workerAlerts(id, replay === 'true');
  }

  @Post('alerts/:id/ack')
  acknowledge(@Param('id') id: string) {
    return this.alerts.acknowledge(id);
  }

  /** Temporary entry point for the emergency path until symptom check-ins exist. */
  @Post('workers/:id/escalate')
  escalate(@Param('id') id: string, @Body() body?: { symptoms?: unknown }) {
    const symptoms = Array.isArray(body?.symptoms)
      ? body.symptoms.filter((s): s is string => typeof s === 'string').slice(0, 10)
      : [];
    return this.alerts.escalate(id, symptoms);
  }
}
