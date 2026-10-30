# SQL de proyectos

La fuente ejecutable es [ProjectsRepository](../projects.repository.ts): usa `Prisma.sql` con parámetros sobre `estadistica_forms.projects`. El modelo Prisma es `Project`.

- Listado: `WHERE owner_id = ownerId`, orden `created_at DESC, id DESC`.
- Detalle: `WHERE id = id AND owner_id = ownerId`.
- Creación: `INSERT ... SELECT ... FROM app_users WHERE id = ownerId`. El usuario autenticado determina el propietario; si ya no existe, no inserta y responde 404.
- Actualización: filtra simultáneamente ID y propietario. Un nombre nuevo conserva configuración; la terna país/moneda/canal se escribe junta, validada antes por el servicio y el DTO.
- Todas las escrituras devuelven la proyección con `RETURNING`. `configurationStatus` se deriva de las columnas, sin persistir un estado duplicado.

La [migración](../../../prisma/migrations/20261025000100_configure_projects/migration.sql) renombra la tabla anterior, sus restricciones e índice y añade configuración. Una fila anterior mantiene sus datos y recibe tres valores nulos. La API valida códigos ISO; SQL comprueba forma, perfil y coherencia de la terna.

La única API de esta funcionalidad es `/api/v1/projects`. La creación exige configuración completa. Las filas migradas pueden completarse mediante PATCH antes de usarse en importación.
