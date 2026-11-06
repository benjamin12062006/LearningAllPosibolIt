import { Controller, Get } from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * `GET /api/v1/health`, pública y sin detalles (plan jobs&files, D12): `200` si
 * la base responde, `503` si no. Sirve al balanceador y a la monitorización;
 * por eso no dice qué falló ni cuántos trabajos hay.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    if (!(await this.isDatabaseReachable())) {
      throw apiError(ErrorCodes.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok' };
  }

  private async isDatabaseReachable() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
