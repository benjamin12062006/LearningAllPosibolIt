import {
  Controller,
  Get,
  Headers,
  Param,
  Res,
  StreamableFile,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Response } from 'express';
import { PRODUCTS_TSV_TYPE } from '../exports/products-tsv.js';
import { FeedDeliveryService } from './feed-delivery.service.js';

/**
 * Revalidar antes de usar una copia guardada: una caché nunca sirve una versión
 * antigua mientras dura un `max-age` (D8, contraste de C7).
 */
const CACHE_CONTROL = 'no-cache';

/**
 * URL pública y estable del feed, `/feeds/<token>.tsv`, sin sesión. Queda fuera
 * del prefijo `api` (`configureHttp`) y es neutral a la versión, así que tampoco
 * lleva `/v1` (F24, F31).
 */
@Controller({ path: 'feeds', version: VERSION_NEUTRAL })
export class FeedDeliveryController {
  constructor(private readonly delivery: FeedDeliveryService) {}

  @Get(':file')
  async download(
    @Param('file') fileName: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const delivery = await this.delivery.open(fileName, ifNoneMatch);
    response.setHeader('ETag', delivery.entityTag);
    response.setHeader('Cache-Control', CACHE_CONTROL);

    if (delivery.status === 'not-modified') {
      response.status(304);
      return;
    }
    return new StreamableFile(delivery.content, {
      type: PRODUCTS_TSV_TYPE,
      length: delivery.byteSize,
    });
  }
}
