import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UsersModule } from '../users/users.module.js';
import { EvaluationsController } from './evaluations.controller.js';
import { EvaluationsRepository } from './evaluations.repository.js';
import { EvaluationsService } from './evaluations.service.js';
import {
  EVALUATION_OPTIONS,
  type EvaluationOptions,
} from './evaluations.types.js';
import { EvaluationWorker } from './evaluations.worker.js';

@Module({
  imports: [AuthModule, PrismaModule, ProjectsModule, UsersModule],
  controllers: [EvaluationsController],
  providers: [
    EvaluationsRepository,
    EvaluationsService,
    EvaluationWorker,
    {
      provide: EVALUATION_OPTIONS,
      useFactory: (): EvaluationOptions => ({
        autoStart: true,
        pollMs: 1000,
        shutdownMs: 5000,
      }),
    },
  ],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
