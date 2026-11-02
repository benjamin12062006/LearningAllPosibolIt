export const ARTIFACT_STORE_OPTIONS = Symbol('ARTIFACT_STORE_OPTIONS');
export type ArtifactStoreOptions = {
  /** Carpeta raíz de los archivos privados (`tmp/`, `artifacts/`…). */
  root: string;
};
