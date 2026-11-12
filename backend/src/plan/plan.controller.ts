import { Controller, Get, Param, Query } from '@nestjs/common';
import { AccessService } from '../auth/access.service.js';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/token.service.js';
import { PlanService } from './plan.service.js';

@Controller()
export class PlanController {
  constructor(
    private readonly plan: PlanService,
    private readonly access: AccessService,
  ) {}

  /** Planning view for a day (default: tomorrow, UTC). Example: GET /sites/:id/plan?date=2025-07-15 */
  @Get('sites/:id/plan')
  async planDay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('date') date?: string) {
    await this.access.assertSite(user, id);
    return this.plan.planDay(id, date || undefined, await this.access.visibleCrewIds(user, id));
  }
}
