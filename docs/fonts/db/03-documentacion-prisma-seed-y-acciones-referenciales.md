# 03 — Documentación Prisma: seed y acciones referenciales

Fecha de creación: 2026-10-30  
Tipo de fuente: documentación oficial  
Origen: Prisma ORM v7.  
Fecha de consulta: 2026-10-30  
Relacionada con: [curso Nest: semillas y eliminación](02-curso-nest-semillas-y-eliminacion.md), [plan de semillas](../../plans/db/02-plan-semillas-de-desarrollo.md), [plan de eliminación](../../plans/db/03-plan-eliminacion-de-datos.md).

Versión del proyecto: `prisma` y `@prisma/client` 7.10.0, según [package.json](../../../package.json).

## Necesidad de consulta

Confirmar cómo se configura y ejecuta una semilla en Prisma 7 con `prisma.config.ts`, y qué hace cada acción `onDelete` en PostgreSQL.

## Localización verificable

| ID | Página | Sección |
| --- | --- | --- |
| F5 | [Prisma ORM v7: Seeding](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding) | Configuración en `prisma.config.ts`; ejecución del comando |
| F6 | [Prisma: Referential actions](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/referential-actions) | Acciones `onDelete` y valores por defecto |

## Evidencia

- **F5:** la semilla se declara en `migrations.seed` de `prisma.config.ts` (ejemplo: `tsx prisma/seed.ts`) y se ejecuta con `prisma db seed`. Se le pasan argumentos después de `--`. **En v7 ya no se ejecuta automáticamente** con `migrate dev` ni `migrate reset`: solo se lanza cuando se pide. El ejemplo crea `PrismaClient` con el adaptador `@prisma/adapter-pg`, el mismo que usa este proyecto.
- **F6:** `Cascade` borra los registros que apuntan al registro eliminado. `Restrict` impide el borrado si existen referencias. `NoAction` se comporta como `Restrict`, pero permite aplazar la comprobación hasta el final de la transacción. `SetNull` solo es válido en relaciones opcionales. En relaciones obligatorias, el valor por defecto de `onDelete` es `Restrict`. La página no explica si cambiar la acción requiere una migración.

## Interpretación y límites

- Que v7 no lance la semilla automáticamente encaja con la [operación actual](../../../README.md): Prisma CLI solo aplica migraciones (`db:migrate`) y nunca debe sembrar Cloud SQL por accidente.
- La protección contra ejecutar la semilla en producción no forma parte de Prisma. Es responsabilidad del script.
- Las acciones referenciales de este proyecto se definen en el SQL de las migraciones (`ON DELETE RESTRICT` en [20261026000100_create_catalog_import](../../../prisma/migrations/20261026000100_create_catalog_import/migration.sql)) y se reflejan en [schema.prisma](../../../prisma/schema.prisma). **Inferencia:** cambiar `Restrict` por `Cascade` cambia la restricción en PostgreSQL, por lo que necesita una migración nueva. No se deben editar las ya aplicadas.

## Aplicación en el proyecto

- **Semillas:** usar `migrations.seed` con `tsx` (ya está en `devDependencies`) y un comando `pnpm db:seed`. El script se protege comprobando el destino antes de escribir nada.
- **Eliminación:** usar `Cascade` solo en las relaciones hijo → snapshot y mantener `Restrict` en snapshot → proyecto y en proyecto → usuario, con un borrado explícito en transacción. Detalle en el [plan 03](../../plans/db/03-plan-eliminacion-de-datos.md).
