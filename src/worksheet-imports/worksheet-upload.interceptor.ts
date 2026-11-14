import {
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { defer, lastValueFrom } from 'rxjs';
import { IMPORT_LIMITS } from '../catalog-import/import.types.js';
import { apiError } from '../common/http/api-error.js';
import { ErrorCodes } from '../common/http/error-codes.js';

/** Campos de texto que admite el formulario, además del archivo `file`. */
/** `mappingId` elige una plantilla de mapeo de la hoja (H3). */
const FORM_FIELDS = ['delimiter', 'sheet', 'headerRow', 'options', 'mappingId'];

/**
 * Un CSV o un XLSX de hoja cabe en memoria: como mucho 10 MiB (plan
 * imports&exports 01, D1 y D12). multer corta la subida al pasar el límite,
 * así que nunca se guarda más.
 * Va después del guard: a quien no tiene sesión no se le lee el cuerpo.
 */
const UPLOAD_LIMITS: multer.Options['limits'] = {
  files: 1,
  fields: FORM_FIELDS.length,
  parts: FORM_FIELDS.length + 1,
  fileSize: IMPORT_LIMITS.fileBytes,
  fieldNameSize: 64,
  fieldSize: 262_144,
};

export type WorksheetUploadRequest = Request & {
  file?: Express.Multer.File;
  body: Record<string, unknown>;
};

@Injectable()
export class WorksheetUploadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<WorksheetUploadRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    return defer(async () => {
      await receive(request, response);
      if (!request.file) {
        throw apiError(ErrorCodes.IMPORT_FILE_REQUIRED);
      }
      if (!hasOnlyTextFields(request.body)) {
        throw apiError(ErrorCodes.IMPORT_INPUT_INVALID);
      }
      return lastValueFrom(next.handle());
    });
  }
}

async function receive(request: WorksheetUploadRequest, response: Response) {
  const upload = multer({
    storage: multer.memoryStorage(),
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

function hasOnlyTextFields(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    Object.entries(body).every(
      ([key, value]) => FORM_FIELDS.includes(key) && typeof value === 'string',
    )
  );
}

function translateUploadError(error: unknown) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return apiError(ErrorCodes.IMPORT_FILE_TOO_LARGE);
  }
  if (error instanceof HttpException) {
    return error;
  }
  return apiError(ErrorCodes.IMPORT_MULTIPART_INVALID);
}
