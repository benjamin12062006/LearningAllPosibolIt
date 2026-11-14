export const ARTIFACT_STORE_OPTIONS = Symbol('ARTIFACT_STORE_OPTIONS');
export type ArtifactStoreOptions = {
  /** Carpeta raíz de los archivos privados (`tmp/`, `artifacts/`…). */
  root: string;
};

/**
 * Destino de un archivo que se genera por trozos: quien lo escribe no sabe
 * dónde acaba ni cómo se cuenta (lo hace `ArtifactStore`).
 */
export type ByteSink = Readonly<{ write(chunk: Buffer): Promise<void> }>;

/**
 * El archivo no está en el bucket. Es el equivalente de `ENOENT` en
 * `CloudStorageArtifactStore`, para que las features no distingan dónde se
 * guardan los archivos (deploys, plan 06, D7).
 */
export class ArtifactNotFoundError extends Error {
  constructor() {
    super('El archivo no existe en el almacenamiento.');
  }
}

/** El archivo no existe: `ENOENT` en disco o `ArtifactNotFoundError` en el bucket. */
export function isMissingFile(error: unknown) {
  if (error instanceof ArtifactNotFoundError) {
    return true;
  }
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
