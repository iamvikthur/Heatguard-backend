import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RiskService } from './risk.service.js';

// TODO(auth): these routes are open until the auth module and role guard land.
@Controller()
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  /** Run the assessment for every site now. */
  @Post('risk/run')
  runAll() {
    return this.risk.runAll();
  }

  @Post('sites/:id/risk/run')
  runForSite(@Param('id') id: string) {
    return this.risk.runForSite(id);
  }

  /** Latest stored 6-hour outlook for a site, by crew. ?replay=true returns the latest replayed day. */
  @Get('sites/:id/outlook')
  outlook(@Param('id') id: string, @Query('replay') replay?: string) {
    return this.risk.outlook(id, replay === 'true');
  }

  /** Replay a past day from data/raw, e.g. POST /sites/:id/replay?date=2025-07-15, and return its timeline. */
  @Post('sites/:id/replay')
  async replay(@Param('id') id: string, @Query('date') date = '') {
    const summary = await this.risk.replayDay(id, date);
    return { summary, timeline: await this.risk.outlook(id, true) };
  }

  @Get('sites')
  sites() {
    return this.risk.listSites();
  }
}
