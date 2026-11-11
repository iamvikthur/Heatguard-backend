import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessService } from './access.service.js';
import { AuditService } from './audit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [TokenService, AccessService, AuditService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokenService, AccessService, AuditService],
})
export class AuthModule {}
