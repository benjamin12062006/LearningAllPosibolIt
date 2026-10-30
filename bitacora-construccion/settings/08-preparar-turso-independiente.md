# 08 — Recuperar Turso como integración independiente

Fecha de creación: 2026-10-22
Última actualización: 2026-10-22
Estado: Implementado y verificado localmente; integración futura sin consumidores
Ámbito: conexión TypeScript, cliente Prisma separado, variables y migraciones Turso
Relacionada con: [conexión PostgreSQL](06-conectar-nest-a-cloud-sql-postgresql.md), [activación remota](07-aplicar-migraciones-y-verificar-cloud-sql.md), [retirada posterior](09-retirar-turso-tras-guardar-restauracion.md).
Revisión de referencia: `01a16a43bd61681bef0c603a31d0d2b280e423b3`, con los cambios PostgreSQL de esta conversación conservados.

Aviso histórico: esta preparación fue retirada posteriormente por petición del usuario. El código, las rutas y la guía descritos abajo corresponden al commit de restauración `a551ed8`; ya no están en el árbol actual. Para consultar la guía histórica: `git show a551ed8:docs/turso/01-conexion-y-migraciones-preparadas.md`.

## Necesidad y decisión

El usuario aclara que desea conservar Turso listo para una funcionalidad futura. PostgreSQL permanece conectado a perfiles y espacios. Se restauran código, dependencias, variables y herramientas Turso, sin importarlo en los módulos activos ni abrir una conexión durante el arranque.

## Evidencia y adaptación propuesta

Se consultaron con `git show HEAD:...` los archivos anteriores `src/database/database-connection.ts`, `src/database/prisma.service.ts`, `prisma/schema.prisma`, `scripts/db/migrate-prisma-to-turso.mjs` y sus pruebas. El commit de referencia conserva la integración `PrismaLibSql`, el cliente libSQL y el migrador con checksums/baseline.

La adaptación separa el cliente generado SQLite del cliente PostgreSQL y da a Turso su propia carpeta de migraciones. El servicio solo abre conexiones al llamar explícitamente `connect()`. Las variables privadas eliminadas no están versionadas en Git; se restauraron sus nombres sin inventar credenciales.

## Implementación y responsabilidades

- `TursoService` (`src/database/turso/turso.service.ts` en `a551ed8`) abre explícitamente un cliente compartido y libera sus recursos al cerrar el módulo. Su construcción no consulta configuración ni conecta. `TursoModule` estaba disponible, sin importarse desde ningún módulo funcional activo.
- `resolveTursoConnection` (`src/database/turso/turso.connection.ts` en `a551ed8`) exige las variables exclusivas Turso, sin tomar la configuración PostgreSQL. `.env` y `.env.example` recuperan `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`; en el entorno privado ambas quedan vacías, pendientes de valores reales.
- El schema `prisma/turso/schema.prisma` y `prisma.turso.config.ts`, conservados en `a551ed8`, generan `src/generated/prisma-turso`, diferente del cliente PostgreSQL. Se restauraron `@libsql/client@0.18.0` y `@prisma/adapter-libsql@7.10.0`.
- El migrador `scripts/db/migration-turso.mjs`, conservado en `a551ed8`, mantiene checksums, transacciones y baseline del migrador original. Usa únicamente `prisma/migrations-turso`. Los tres SQL se recuperaron byte por byte desde Git. El archivo `prisma/sqlite-legacy` no se convirtió en carpeta operativa.
- `pnpm db:turso:status` consulta y `pnpm db:turso:migrate` aplica cambios solamente mediante ejecución manual. El arranque no migra; la generación de ambos clientes tampoco abre conexiones.

Esta es una adaptación del código histórico propio, no una nueva implementación atribuida a un curso. PostgreSQL sigue atendiendo usuarios, sincronización y espacios; no se cambió su configuración ni se operó sobre ninguna base remota durante este incremento.

## Comprobaciones ejecutadas

- Generación de ambos clientes Prisma y compilación Nest: correctas.
- `oxlint --type-aware src/`: correcto.
- Validación Prisma de PostgreSQL y de `prisma.turso.config.ts`: correctas.
- `node --test --test-concurrency=1 test/*.test.mjs`: **20/20 aprobadas**, sin omitidas. Las pruebas PostgreSQL usan PGlite temporal y las Turso libSQL en memoria; no son conexiones remotas.
- Las cinco pruebas Turso comprueban construcción/cierre sin conexión, variables independientes, conexión explícita con el cliente separado, repetición de migraciones y baseline histórico.
- Comparación directa contra `HEAD:prisma/migrations/...`: los tres SQL Turso son idénticos.
- Búsqueda de importaciones en los módulos activos: no usan `TursoModule`, `TursoService` ni `turso/`.
- Prettier de los archivos nuevos de conexión/configuración/migrador/pruebas y `git diff --check`: correctos.

No se verificaron credenciales Turso remotas ni se ejecutaron sus migraciones remotas. El próximo uso requiere completar sus secretos e importar el módulo expresamente desde una nueva feature; no se ha asignado todavía esa funcionalidad.
