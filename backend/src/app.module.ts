import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RiskModule } from './risk/risk.module.js';

@Module({
  imports: [PrismaModule, AuthModule, RiskModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
