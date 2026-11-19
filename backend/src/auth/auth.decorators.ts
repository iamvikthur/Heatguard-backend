import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser, AuthWorker, Role } from './token.service.js';

export const IS_PUBLIC = 'auth:public';
export const IS_WORKER = 'auth:worker';
export const ROLES = 'auth:roles';

/** Marks a route that needs no login. Everything else requires a valid token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Marks a route a worker reaches with their own sign-in link, never a staff token. */
export const WorkerAuth = () => SetMetadata(IS_WORKER, true);

/** Restricts a route to the given roles. Without it, any signed-in user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The signed-in user, as set by AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  return context.switchToHttp().getRequest<{ user: AuthUser }>().user;
});

/** The worker whose sign-in link was used, as set by AuthGuard. */
export const CurrentWorker = createParamDecorator((_data: unknown, context: ExecutionContext): AuthWorker => {
  return context.switchToHttp().getRequest<{ worker: AuthWorker }>().worker;
});
