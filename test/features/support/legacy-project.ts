import type { PrismaService } from '../../../src/database/prisma.service.js';
import { ensurePersonalOrganization } from '../../../src/organizations/organizations.repository.js';

export type LegacyProject = Readonly<{
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}>;

/**
 * Un proyecto anterior a la configuración de la tienda (sin país, moneda ni
 * canal), dentro de la organización personal de quien lo creó, como quedaron
 * tras el backfill de E1. Desde C6 un proyecto no puede existir sin
 * organización (`organization_id NOT NULL`).
 */
export async function insertLegacyProject(
  prisma: PrismaService,
  project: LegacyProject,
) {
  await prisma.$transaction(async (tx) => {
    const organizationId = await ensurePersonalOrganization(
      tx,
      project.ownerId,
    );
    await tx.$executeRaw`
      INSERT INTO estadistica_forms.projects
        (id, name, owner_id, organization_id, created_at)
      VALUES (
        ${project.id}, ${project.name}, ${project.ownerId}, ${organizationId},
        ${project.createdAt}
      )`;
  });
}
