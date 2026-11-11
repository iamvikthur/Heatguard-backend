import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser, Role } from './token.service.js';

export const IS_PUBLIC = 'auth:public';
export const ROLES = 'auth:roles';

/** Marks a route that needs no login. Everything else requires a valid token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route to the given roles. Without it, any signed-in user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The signed-in user, as set by AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  return context.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
