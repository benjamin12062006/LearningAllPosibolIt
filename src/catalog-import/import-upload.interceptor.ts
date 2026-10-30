import { ErrorCodes } from '../common/http/error-codes.js';
import {
  Injectable,
  HttpException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { apiError } from '../common/http/api-error.js';
import multer from 'multer';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { defer, lastValueFrom } from 'rxjs';
import { ArtifactStore } from './artifact.store.js';
import {
  IMPORT_LIMITS,
  ImportFailure,
  type ImportRequest,
} from './import.types.js';

@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  constructor(private readonly store: ArtifactStore) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<ImportRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    req.importRequestId = randomUUID();
    return defer(async () => {
      try {
        await this.receive(req, response);
        if (!req.file) throw apiError(ErrorCodes.IMPORT_FILE_REQUIRED);
        const body: unknown = req.body;
        if (
          !body ||
          typeof body !== 'object' ||
          Object.entries(body).some(
            ([key, value]) =>
              !['idColumn', 'delimiter'].includes(key) ||
              typeof value !== 'string',
          )
        )
          throw apiError(ErrorCodes.IMPORT_INPUT_INVALID);
        return await lastValueFrom(next.handle());
      } finally {
        if (req.file?.filename)
          await this.store.removeTemporary(req.file.filename);
      }
    });
  }

  private async receive(req: ImportRequest, response: Response) {
    const storage: multer.StorageEngine = {
      _handleFile: (request: Request, file, callback) => {
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        request.once('aborted', onAbort);
        if (request.aborted) abort.abort();
        void this.store.receive(file.stream, abort.signal).then(
          (result) => {
            request.off('aborted', onAbort);
            callback(null, result);
          },
          (error: unknown) => {
            request.off('aborted', onAbort);
            callback(
              error instanceof ImportFailure
                ? error
                : apiError(ErrorCodes.IMPORT_STORAGE_UNAVAILABLE),
            );
          },
        );
      },
      _removeFile: (_request, file, callback) => {
        if (!file.filename) return callback(null);
        void this.store.removeTemporary(file.filename).then(
          () => callback(null),
          () => callback(apiError(ErrorCodes.IMPORT_STORAGE_UNAVAILABLE)),
        );
      },
    };
    const options = {
      storage,
      limits: {
        files: 1,
        fields: 2,
        parts: 3,
        fileSize: IMPORT_LIMITS.fileBytes,
        fieldNameSize: 64,
        fieldSize: 512,
        fieldNestingDepth: 0,
        fieldArrayIndexLimit: 0,
      },
    };
    try {
      await new Promise<void>((resolve, reject) =>
        multer(options).single('file')(req, response, (error: unknown) =>
          error ? reject(error) : resolve(),
        ),
      );
    } catch (error) {
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE')
          throw apiError(ErrorCodes.IMPORT_FILE_TOO_LARGE);
        throw apiError(ErrorCodes.IMPORT_MULTIPART_INVALID);
      }
      if (error instanceof HttpException || error instanceof ImportFailure)
        throw error;
      throw apiError(ErrorCodes.IMPORT_MULTIPART_INVALID);
    }
  }
}
