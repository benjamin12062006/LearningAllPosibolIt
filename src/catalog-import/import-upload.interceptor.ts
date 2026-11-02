import {
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { defer, lastValueFrom } from 'rxjs';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';
import { ArtifactStore } from '../artifacts/artifact.store.js';
import {
  IMPORT_LIMITS,
  ImportFailure,
  type ImportRequest,
} from './import.types.js';

/** Un único archivo `file` y, como mucho, los campos `idColumn` y `delimiter`. */
const UPLOAD_LIMITS: multer.Options['limits'] = {
  files: 1,
  fields: 2,
  parts: 3,
  fileSize: IMPORT_LIMITS.fileBytes,
  fieldNameSize: 64,
  fieldSize: 512,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};

const IMPORT_FORM_FIELDS = ['idColumn', 'delimiter'];

/**
 * Recibe el multipart en streaming hacia `tmp/` (sin cargarlo en memoria),
 * valida el formulario y, pase lo que pase, borra el temporal al terminar.
 */
@Injectable()
export class ImportUploadInterceptor implements NestInterceptor {
  constructor(private readonly store: ArtifactStore) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<ImportRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    request.importRequestId = randomUUID();

    return defer(async () => {
      try {
        await this.receive(request, response);
        if (!request.file) {
          throw apiError(ErrorCodes.IMPORT_FILE_REQUIRED);
        }
        if (!isImportForm(request.body)) {
          throw apiError(ErrorCodes.IMPORT_INPUT_INVALID);
        }
        return await lastValueFrom(next.handle());
      } finally {
        if (request.file?.filename) {
          await this.store.removeTemporary(request.file.filename);
        }
      }
    });
  }

  private async receive(request: ImportRequest, response: Response) {
    const upload = multer({
      storage: this.streamingStorage(),
      limits: UPLOAD_LIMITS,
    }).single('file');

    try {
      await new Promise<void>((resolve, reject) =>
        upload(request, response, (error: unknown) =>
          error ? reject(error) : resolve(),
        ),
      );
    } catch (error) {
      throw translateUploadError(error);
    }
  }

  /** Almacenamiento de multer que delega en `ArtifactStore` y respeta la cancelación del cliente. */
  private streamingStorage(): multer.StorageEngine {
    return {
      _handleFile: (request: Request, file, callback) => {
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        request.once('aborted', onAbort);
        if (request.aborted) {
          abort.abort();
        }

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
        if (!file.filename) {
          return callback(null);
        }
        void this.store.removeTemporary(file.filename).then(
          () => callback(null),
          () => callback(apiError(ErrorCodes.IMPORT_STORAGE_UNAVAILABLE)),
        );
      },
    };
  }
}

/** Solo campos conocidos y todos de texto. */
function isImportForm(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }
  return Object.entries(body).every(
    ([key, value]) =>
      IMPORT_FORM_FIELDS.includes(key) && typeof value === 'string',
  );
}

function translateUploadError(error: unknown) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return apiError(ErrorCodes.IMPORT_FILE_TOO_LARGE);
    }
    return apiError(ErrorCodes.IMPORT_MULTIPART_INVALID);
  }
  if (error instanceof HttpException || error instanceof ImportFailure) {
    return error;
  }
  return apiError(ErrorCodes.IMPORT_MULTIPART_INVALID);
}
