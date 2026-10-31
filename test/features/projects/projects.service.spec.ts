import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { UsersService } from '../../../src/users/users.service.js';
import { ProjectsRepository } from '../../../src/projects/projects.repository.js';
import { ProjectsService } from '../../../src/projects/projects.service.js';
import {
  alice,
  projectFixture,
  projectInput,
  userFixture,
} from '../support/project-fixtures.js';

describe('ProjectsService con inyección de Nest', () => {
  let module: TestingModule;
  let service: ProjectsService;
  let users: jest.Mocked<Pick<UsersService, 'findCurrent'>>;
  let repository: jest.Mocked<
    Pick<
      ProjectsRepository,
      'findAllByOwner' | 'findByOwner' | 'create' | 'update'
    >
  >;

  beforeEach(async () => {
    users = {
      findCurrent: jest
        .fn<UsersService['findCurrent']>()
        .mockResolvedValue(userFixture()),
    };
    repository = {
      findAllByOwner: jest
        .fn<ProjectsRepository['findAllByOwner']>()
        .mockResolvedValue([projectFixture()]),
      findByOwner: jest
        .fn<ProjectsRepository['findByOwner']>()
        .mockResolvedValue(projectFixture()),
      create: jest
        .fn<ProjectsRepository['create']>()
        .mockResolvedValue(projectFixture()),
      update: jest
        .fn<ProjectsRepository['update']>()
        .mockResolvedValue(projectFixture()),
    };
    module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: UsersService, useValue: users },
        { provide: ProjectsRepository, useValue: repository },
      ],
    }).compile();
    service = module.get(ProjectsService);
  });

  afterEach(async () => {
    await module?.close();
  });

  it('lista usando el ID local resuelto desde la identidad y el resultado del proveedor inyectado', async () => {
    const expected = [projectFixture({ name: 'Resultado del doble' })];
    repository.findAllByOwner.mockResolvedValue(expected);

    const result = await service.findAll(alice);

    expect(users.findCurrent).toHaveBeenCalledWith(alice);
    // Pide una fila más que el límite para calcular `hasMore` sin COUNT.
    expect(repository.findAllByOwner).toHaveBeenCalledWith(userFixture().id, {
      limit: 21,
      offset: 0,
    });
    expect(result).toEqual({
      items: expected,
      page: { limit: 20, offset: 0, hasMore: false },
    });
  });

  it('recorta la fila extra y marca hasMore cuando hay más páginas', async () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      projectFixture({ id: `00000000-0000-4000-8000-00000000000${index}` }),
    );
    repository.findAllByOwner.mockResolvedValue(rows);

    const result = await service.findAll(alice, { limit: 2, offset: 4 });

    expect(repository.findAllByOwner).toHaveBeenCalledWith(userFixture().id, {
      limit: 3,
      offset: 4,
    });
    expect(result.items).toEqual(rows.slice(0, 2));
    expect(result.page).toEqual({ limit: 2, offset: 4, hasMore: true });
  });

  it('crea la configuración bajo el propietario autenticado', async () => {
    await expect(service.create(alice, projectInput)).resolves.toEqual(
      projectFixture(),
    );
    expect(repository.create).toHaveBeenCalledWith(
      userFixture().id,
      projectInput.name,
      {
        country: 'US',
        currency: 'USD',
        channelProfile: 'google_merchant',
      },
    );
  });

  it('no escribe si el perfil local no existe', async () => {
    users.findCurrent.mockRejectedValue(new NotFoundException());

    await expect(service.create(alice, projectInput)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('oculta un proyecto ausente o ajeno sin actualizarlo', async () => {
    repository.findByOwner.mockResolvedValue(null);

    await expect(
      service.findOwned(alice, projectFixture().id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update(alice, projectFixture().id, { name: 'Ajeno' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findByOwner).toHaveBeenCalledWith(
      userFixture().id,
      projectFixture().id,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { country: 'US' },
    { currency: 'USD', channelProfile: 'google_merchant' as const },
  ])('rechaza PATCH vacío o configuración parcial: %j', async (input) => {
    await expect(
      service.update(alice, projectFixture().id, input),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('permite renombrar sin reemplazar la configuración', async () => {
    repository.update.mockResolvedValue(projectFixture({ name: 'Otro' }));

    await expect(
      service.update(alice, projectFixture().id, { name: 'Otro' }),
    ).resolves.toMatchObject({ name: 'Otro', country: 'US' });
    expect(repository.update).toHaveBeenCalledWith(
      userFixture().id,
      projectFixture().id,
      { name: 'Otro' },
    );
  });

  it('actualiza la terna completa y comprueba que la fila sigue existiendo', async () => {
    const configuration = {
      country: 'BO',
      currency: 'BOB',
      channelProfile: 'google_merchant' as const,
    };
    repository.update.mockResolvedValue(null);

    await expect(
      service.update(alice, projectFixture().id, configuration),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).toHaveBeenCalledWith(
      userFixture().id,
      projectFixture().id,
      configuration,
    );
  });

  it('impide continuar hacia importación si falta configuración heredada', async () => {
    repository.findByOwner.mockResolvedValue(
      projectFixture({
        country: null,
        currency: null,
        channelProfile: null,
        configurationStatus: 'required',
      }),
    );

    const operation = service.requireConfigured(alice, projectFixture().id);

    await expect(operation).rejects.toBeInstanceOf(ConflictException);
    await expect(operation).rejects.toMatchObject({
      response: { code: 'PROJECT_CONFIGURATION_REQUIRED' },
    });
  });

  it('entrega el proyecto configurado para la futura importación', async () => {
    await expect(
      service.requireConfigured(alice, projectFixture().id),
    ).resolves.toEqual(projectFixture());
  });
});
