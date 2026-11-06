import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../src/database/prisma.service.js';
import { HealthController } from '../../../src/health/health.controller.js';

describe('HealthController (jobs&files E6, D12)', () => {
  it('responde 503 sin detalles si la base no contesta', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: () => Promise.reject(new Error('connection refused')),
          },
        },
      ],
    }).compile();

    await expect(module.get(HealthController).check()).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
    });
    await module.close();
  });
});
