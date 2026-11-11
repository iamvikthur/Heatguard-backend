import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './token.service.js';

/**
 * Who may see what:
 * - Everyone is limited to their own organisation.
 * - HSE and ADMIN see every site and crew in it.
 * - A SUPERVISOR sees only the crews they supervise, and those crews' workers.
 * A record outside the caller's scope is reported as not found, so ids cannot be probed.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertSite(user: AuthUser, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, orgId: user.orgId }, select: { id: true } });
    if (!site) throw new NotFoundException('Site not found');
  }

  async assertCrew(user: AuthUser, crewId: string): Promise<void> {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, site: { orgId: user.orgId }, ...this.supervisorFilter(user) },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
  }

  async assertWorker(user: AuthUser, workerId: string): Promise<void> {
    const worker = await this.prisma.worker.findFirst({
      where: { id: workerId, crew: { site: { orgId: user.orgId }, ...this.supervisorFilter(user) } },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker not found');
  }

  /** Checks access to an alert through the crew or worker it belongs to. */
  async assertAlert(user: AuthUser, alertId: string): Promise<void> {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId }, select: { crewId: true, workerId: true } });
    if (alert?.crewId) return this.assertCrew(user, alert.crewId);
    if (alert?.workerId) return this.assertWorker(user, alert.workerId);
    throw new NotFoundException('Alert not found');
  }

  /** Ids of the crews the caller may see at a site. */
  async visibleCrewIds(user: AuthUser, siteId: string): Promise<Set<string>> {
    const crews = await this.prisma.crew.findMany({
      where: { siteId, site: { orgId: user.orgId }, ...this.supervisorFilter(user) },
      select: { id: true },
    });
    return new Set(crews.map((crew) => crew.id));
  }

  supervisorFilter(user: AuthUser): { supervisorId?: string } {
    return user.role === 'SUPERVISOR' ? { supervisorId: user.id } : {};
  }
}
