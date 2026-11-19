import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { IS_PUBLIC, IS_WORKER, ROLES } from './auth.decorators.js';
import { type AuthUser, type AuthWorker, type Role, TokenService } from './token.service.js';

interface Request {
  headers: Record<string, unknown>;
  user?: AuthUser;
  worker?: AuthWorker;
}

/**
 * Global guard. Every route needs a Bearer token unless it is marked @Public().
 * A route marked @WorkerAuth() takes a worker's sign-in link instead of a staff
 * token; the two token kinds are never interchangeable.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Sign in required');

    if (this.reflector.getAllAndOverride<boolean>(IS_WORKER, targets)) {
      const claimed = this.tokens.verifyWorker(token);
      if (!claimed) throw new UnauthorizedException('This link is not valid');
      const worker = await this.prisma.worker.findUnique({
        where: { id: claimed.id },
        select: { id: true, linkVersion: true, active: true },
      });
      // A newer link, or a worker no longer on the roster, retires the old link.
      if (!worker || !worker.active || worker.linkVersion !== claimed.linkVersion) {
        throw new UnauthorizedException('This link is no longer valid. Ask your supervisor for a new one.');
      }
      request.worker = { id: worker.id, linkVersion: worker.linkVersion };
      return true;
    }

    const user = this.tokens.verify(token);
    if (!user) throw new UnauthorizedException('Sign in required');
    request.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('Your role cannot do this');
    return true;
  }
}
