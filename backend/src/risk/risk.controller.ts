import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AccessService } from '../auth/access.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/token.service.js';
import { RiskService } from './risk.service.js';

@Controller()
export class RiskController {
  constructor(
    private readonly risk: RiskService,
    private readonly access: AccessService,
  ) {}

  /** Run the assessment for every site now. */
  @Roles('ADMIN')
  @Post('risk/run')
  runAll() {
    return this.risk.runAll();
  }

  @Roles('HSE', 'ADMIN')
  @Post('sites/:id/risk/run')
  async runForSite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.access.assertSite(user, id);
    return this.risk.runForSite(id);
  }

  /** Latest stored 6-hour outlook for a site, by crew. ?replay=true returns the latest replayed day. */
  @Get('sites/:id/outlook')
  async outlook(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('replay') replay?: string) {
    await this.access.assertSite(user, id);
    return this.visibleOutlook(user, id, replay === 'true');
  }

  /** Replay a past day from data/raw, e.g. POST /sites/:id/replay?date=2025-07-15, and return its timeline. */
  @Roles('HSE', 'ADMIN')
  @Post('sites/:id/replay')
  async replay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('date') date = '') {
    await this.access.assertSite(user, id);
    const summary = await this.risk.replayDay(id, date);
    return { summary, timeline: await this.visibleOutlook(user, id, true) };
  }

  /** The caller's sites. A supervisor sees only the crews they supervise. */
  @Get('sites')
  sites(@CurrentUser() user: AuthUser) {
    return this.risk.listSites(user.orgId, this.access.supervisorFilter(user).supervisorId);
  }

  private async visibleOutlook(user: AuthUser, siteId: string, replay: boolean) {
    const [outlook, visible] = await Promise.all([this.risk.outlook(siteId, replay), this.access.visibleCrewIds(user, siteId)]);
    return { ...outlook, crews: outlook.crews.filter((crew) => visible.has(crew.crewId)) };
  }
}
