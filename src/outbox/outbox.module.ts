import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { OutboxRelay } from './outbox.relay.js';
import { OutboxRepository } from './outbox.repository.js';
import { OUTBOX_DEFAULTS, OUTBOX_OPTIONS } from './outbox.types.js';

/**
 * Bandeja de salida (plan jobs&files, D8). Las features insertan sus eventos con
 * `enqueueArtifactsDelete` dentro de su transacción y llaman al relay después
 * del commit. La dependencia va de las features hacia aquí, nunca al revés.
 */
@Module({
  imports: [ArtifactsModule, PrismaModule],
  providers: [
    OutboxRelay,
    OutboxRepository,
    { provide: OUTBOX_OPTIONS, useValue: OUTBOX_DEFAULTS },
  ],
  exports: [OutboxRelay],
})
export class OutboxModule {}
