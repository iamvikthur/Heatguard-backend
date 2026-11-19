import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './token.service.js';

/** Records who looked at or acted on an individual worker's data. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A worker acting on their own data through their sign-in link. */
  recordWorker(workerId: string, action: string, detail?: Record<string, string | number | boolean>) {
    return this.record({ id: '', orgId: '', role: 'SUPERVISOR' }, action, 'Worker', workerId, {
      ...detail,
      via: 'worker-link',
    });
  }

  async record(user: AuthUser, action: string, entity: string, entityId: string, detail?: Record<string, string | number | boolean>) {
    try {
      // A worker acting for themselves has no staff actor; detail.via records how.
      await this.prisma.auditLog.create({
        data: { actorId: user.id || null, action, entity, entityId, detail },
      });
    } catch (err) {
      // An audit failure must be visible, but it should not hide the emergency path from a supervisor.
      this.logger.error(`Audit write failed for ${action} ${entity} ${entityId}: ${String(err)}`);
    }
  }
}
