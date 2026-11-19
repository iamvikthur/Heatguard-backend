import { Module } from '@nestjs/common';
import { CheckinsModule } from '../checkins/checkins.module.js';
import { WorkerSelfController } from './worker-self.controller.js';
import { WorkersController } from './workers.controller.js';
import { WorkersService } from './workers.service.js';

@Module({
  imports: [CheckinsModule],
  controllers: [WorkersController, WorkerSelfController],
  providers: [WorkersService],
})
export class WorkersModule {}
