import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RiskModule } from './risk/risk.module.js';

@Module({
  imports: [PrismaModule, RiskModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
