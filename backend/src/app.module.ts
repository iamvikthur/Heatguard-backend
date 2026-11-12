import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PlanModule } from './plan/plan.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RiskModule } from './risk/risk.module.js';

@Module({
  imports: [PrismaModule, AuthModule, RiskModule, PlanModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
