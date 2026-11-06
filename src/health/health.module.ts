import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module.js';
import { HealthController } from './health.controller.js';
import { HEALTH_DEFAULTS, HEALTH_OPTIONS } from './health.types.js';
import { QueueMonitor } from './queue-monitor.js';

/** Salud del servicio y aviso de colas atascadas (plan jobs&files, D12). */
@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [
    QueueMonitor,
    { provide: HEALTH_OPTIONS, useValue: HEALTH_DEFAULTS },
  ],
})
export class HealthModule {}
