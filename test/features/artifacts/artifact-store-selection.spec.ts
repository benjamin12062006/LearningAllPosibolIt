import { describe, expect, it } from '@jest/globals';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { createArtifactStore } from '../../../src/artifacts/artifacts.module.js';
import { CloudStorageArtifactStore } from '../../../src/artifacts/cloud-storage.artifact-store.js';

const LOCAL = { root: '/tmp/no-se-usa' };

describe('ArtifactsModule: dónde se guardan los archivos', () => {
  it('sin ARTIFACT_BUCKET, en la carpeta local de siempre', () => {
    expect(createArtifactStore(undefined, LOCAL)).toBeInstanceOf(ArtifactStore);
    expect(createArtifactStore('  ', LOCAL)).toBeInstanceOf(ArtifactStore);
  });

  it('con ARTIFACT_BUCKET, en ese bucket de Cloud Storage', () => {
    expect(createArtifactStore('ktsu-artifacts', LOCAL)).toBeInstanceOf(
      CloudStorageArtifactStore,
    );
  });
});
