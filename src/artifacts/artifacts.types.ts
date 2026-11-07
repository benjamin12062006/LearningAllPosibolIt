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
