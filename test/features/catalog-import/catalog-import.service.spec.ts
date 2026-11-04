import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { apiError } from '../../../src/common/http/api-error.js';
import { CatalogImportService } from '../../../src/catalog-import/catalog-import.service.js';
import { CatalogImportRepository } from '../../../src/catalog-import/catalog-import.repository.js';
import { CatalogImportWorker } from '../../../src/catalog-import/catalog-import.worker.js';
import { ArtifactStore } from '../../../src/artifacts/artifact.store.js';
import { UsersService } from '../../../src/users/users.service.js';
import {
  alice,
  projectFixture,
  userFixture,
} from '../support/project-fixtures.js';

describe('Aceptación y compensación de importaciones', () => {
  let module: TestingModule;
  let service: CatalogImportService;
  let repository: jest.Mocked<
    Pick<CatalogImportRepository, 'accept' | 'acceptanceExists'>
  >;
  let store: jest.Mocked<Pick<ArtifactStore, 'finalize' | 'removeArtifact'>>;
  let worker: jest.Mocked<Pick<CatalogImportWorker, 'wake'>>;
  const upload = {
    filename: 'temporary',
    originalname: '../../shop.csv',
    hash: '0'.repeat(64),
    size: 20,
  };
  const fields = { idColumn: 'id', delimiter: 'comma' as const };
  const accept = () =>
    service.accept(
      userFixture().id,
      projectFixture().id,
      upload,
      fields,
      'request-test',
    );

  beforeEach(async () => {
    repository = {
      accept: jest
        .fn<CatalogImportRepository['accept']>()
        .mockResolvedValue(undefined),
      acceptanceExists: jest
        .fn<CatalogImportRepository['acceptanceExists']>()
        .mockResolvedValue(false),
    };
    store = {
      finalize: jest
        .fn<ArtifactStore['finalize']>()
        .mockResolvedValue(undefined),
      removeArtifact: jest
        .fn<ArtifactStore['removeArtifact']>()
        .mockResolvedValue(undefined),
    };
    worker = { wake: jest.fn<CatalogImportWorker['wake']>() };
    module = await Test.createTestingModule({
      providers: [
        CatalogImportService,
        { provide: CatalogImportRepository, useValue: repository },
        { provide: ArtifactStore, useValue: store },
        { provide: CatalogImportWorker, useValue: worker },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();
    service = module.get(CatalogImportService);
  });
  afterEach(async () => {
    await module.close();
  });

  it('confirma aceptación con IDs propios y URL relativa sin exponer rutas', async () => {
    const result = await accept();
    expect(result).toEqual({
      snapshotId: expect.any(String),
      jobId: expect.any(String),
      status: 'queued',
      statusUrl: expect.stringMatching(/^\/api\/v1\/projects\/.+\/jobs\//),
    });
    expect(repository.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: userFixture().id,
        projectId: projectFixture().id,
        originalName: '.._.._shop.csv',
        snapshotId: result.snapshotId,
        jobId: result.jobId,
      }),
    );
    expect(worker.wake).toHaveBeenCalledTimes(1);
    expect(store.removeArtifact).not.toHaveBeenCalled();
  });

  it('un alta fallida con ausencia confirmada retira solo su archivo final', async () => {
    repository.accept.mockRejectedValue(new Error('SQL no público'));
    await expect(accept()).rejects.toMatchObject({ status: 503 });
    const input = repository.accept.mock.calls[0][0];
    expect(repository.acceptanceExists).toHaveBeenCalledWith(input);
    expect(store.removeArtifact).toHaveBeenCalledWith(input.artifactKey);
    expect(worker.wake).not.toHaveBeenCalled();
  });

  it('recupera un commit confirmado cuya respuesta se perdió y conserva el archivo', async () => {
    repository.accept.mockRejectedValue(
      new Error('Respuesta perdida tras commit'),
    );
    repository.acceptanceExists.mockResolvedValue(true);
    await expect(accept()).resolves.toMatchObject({ status: 'queued' });
    expect(store.removeArtifact).not.toHaveBeenCalled();
    expect(worker.wake).toHaveBeenCalledTimes(1);
  });

  it('conserva el final si la base no puede confirmar el resultado del commit', async () => {
    repository.accept.mockRejectedValue(new Error('Conexión perdida'));
    repository.acceptanceExists.mockRejectedValue(
      new Error('Base inaccesible'),
    );
    await expect(accept()).rejects.toMatchObject({
      response: { code: 'IMPORT_ACCEPTANCE_UNCERTAIN' },
    });
    expect(store.removeArtifact).not.toHaveBeenCalled();
    expect(worker.wake).not.toHaveBeenCalled();
  });

  it('no intenta aceptar ni borra un archivo ajeno si la finalización falla', async () => {
    store.finalize.mockRejectedValue(new Error('Colisión o fallo de disco'));
    await expect(accept()).rejects.toMatchObject({
      response: { code: 'IMPORT_STORAGE_UNAVAILABLE' },
    });
    expect(repository.accept).not.toHaveBeenCalled();
    expect(store.removeArtifact).not.toHaveBeenCalled();
  });
});

describe('Borrado de importaciones y proyectos', () => {
  let module: TestingModule;
  let service: CatalogImportService;
  let repository: jest.Mocked<
    Pick<CatalogImportRepository, 'deleteSnapshot' | 'deleteProject'>
  >;
  let store: jest.Mocked<
    Pick<ArtifactStore, 'removeArtifact' | 'removeExport' | 'removeFeedVersion'>
  >;
  const steps: string[] = [];

  beforeEach(async () => {
    steps.length = 0;
    repository = {
      deleteSnapshot: jest
        .fn<CatalogImportRepository['deleteSnapshot']>()
        .mockImplementation(async (_owner, _project, snapshotId) => {
          steps.push('commit');
          return { snapshotId, artifactKey: 'k1.csv', exportArtifactKeys: [] };
        }),
      deleteProject: jest
        .fn<CatalogImportRepository['deleteProject']>()
        .mockImplementation(async () => {
          steps.push('commit');
          return {
            imports: [
              {
                snapshotId: 's1',
                artifactKey: 'k1.csv',
                exportArtifactKeys: [],
              },
              {
                snapshotId: 's2',
                artifactKey: 'k2.csv',
                exportArtifactKeys: [],
              },
            ],
            feedArtifactKeys: [],
          };
        }),
    };
    store = {
      removeArtifact: jest
        .fn<ArtifactStore['removeArtifact']>()
        .mockImplementation(async (key) => {
          steps.push(`archivo ${key}`);
        }),
      removeExport: jest
        .fn<ArtifactStore['removeExport']>()
        .mockImplementation(async (key) => {
          steps.push(`tsv ${key}`);
        }),
      removeFeedVersion: jest
        .fn<ArtifactStore['removeFeedVersion']>()
        .mockImplementation(async (key) => {
          steps.push(`feed ${key}`);
        }),
    };
    module = await Test.createTestingModule({
      providers: [
        CatalogImportService,
        { provide: CatalogImportRepository, useValue: repository },
        { provide: ArtifactStore, useValue: store },
        { provide: CatalogImportWorker, useValue: {} },
        {
          provide: UsersService,
          useValue: { findCurrent: async () => userFixture() },
        },
      ],
    }).compile();
    service = module.get(CatalogImportService);
  });
  afterEach(async () => {
    await module.close();
  });

  it('retira los archivos solo después de que la base confirma el borrado', async () => {
    await service.deleteProject(alice, projectFixture().id);
    expect(steps).toEqual(['commit', 'archivo k1.csv', 'archivo k2.csv']);
    expect(repository.deleteProject).toHaveBeenCalledWith(
      userFixture().id,
      projectFixture().id,
    );
  });

  it('si la base rechaza el borrado no toca ningún archivo', async () => {
    repository.deleteSnapshot.mockRejectedValue(apiError('IMPORT_IN_PROGRESS'));
    await expect(
      service.deleteImport(alice, projectFixture().id, 's1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(store.removeArtifact).not.toHaveBeenCalled();
  });

  it('un fallo al retirar el archivo no deshace el borrado ni falla la petición', async () => {
    store.removeArtifact.mockRejectedValue(new Error('EIO'));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.deleteImport(alice, projectFixture().id, 's1'),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith({
      code: 'IMPORT_ORPHAN_RETAINED',
      snapshotId: 's1',
    });
  });

  it('retira también los TSV de las exportaciones borradas en cascada, después del commit', async () => {
    repository.deleteProject.mockImplementationOnce(async () => {
      steps.push('commit');
      return {
        imports: [
          {
            snapshotId: 's1',
            artifactKey: 'k1.csv',
            exportArtifactKeys: ['e1.tsv'],
          },
          { snapshotId: 's2', artifactKey: 'k2.csv', exportArtifactKeys: [] },
        ],
        feedArtifactKeys: [],
      };
    });

    await service.deleteProject(alice, projectFixture().id);

    expect(steps).toEqual([
      'commit',
      'archivo k1.csv',
      'tsv e1.tsv',
      'archivo k2.csv',
    ]);
  });

  it('borrar el proyecto retira los archivos de su feed, después del commit', async () => {
    repository.deleteProject.mockImplementationOnce(async () => {
      steps.push('commit');
      return {
        imports: [
          { snapshotId: 's1', artifactKey: 'k1.csv', exportArtifactKeys: [] },
        ],
        feedArtifactKeys: ['v1.tsv', 'v2.tsv'],
      };
    });

    await service.deleteProject(alice, projectFixture().id);

    expect(steps).toEqual([
      'commit',
      'archivo k1.csv',
      'feed v1.tsv',
      'feed v2.tsv',
    ]);
  });

  it('un fallo al retirar un archivo del feed se registra y sigue con los demás', async () => {
    repository.deleteProject.mockImplementationOnce(async () => ({
      imports: [],
      feedArtifactKeys: ['v1.tsv', 'v2.tsv'],
    }));
    store.removeFeedVersion.mockRejectedValueOnce(new Error('EIO'));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.deleteProject(alice, projectFixture().id),
    ).resolves.toBeUndefined();
    expect(store.removeFeedVersion).toHaveBeenCalledWith('v2.tsv');
    expect(logError).toHaveBeenCalledWith({
      code: 'FEED_ORPHAN_RETAINED',
      projectId: projectFixture().id,
    });
  });

  it('un fallo al retirar un TSV se registra y no falla la petición', async () => {
    repository.deleteSnapshot.mockImplementationOnce(async () => ({
      snapshotId: 's1',
      artifactKey: 'k1.csv',
      exportArtifactKeys: ['e1.tsv', 'e2.tsv'],
    }));
    store.removeExport.mockRejectedValueOnce(new Error('EIO'));
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.deleteImport(alice, projectFixture().id, 's1'),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith({
      code: 'EXPORT_ORPHAN_RETAINED',
      snapshotId: 's1',
    });
    expect(store.removeExport).toHaveBeenCalledWith('e2.tsv');
  });
});
