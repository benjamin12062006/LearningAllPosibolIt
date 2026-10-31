# 14 — Ajustar límites y consultas

Fecha de creación: 2026-10-30
Última actualización: 2026-10-30
Estado: Implementado, verificado y migración aplicada en Neon
Ámbito: paginación de listados, listado de importaciones, una importación activa por proyecto y límites documentados
Relacionada con: [plan feature/04](../../docs/plans/feature/projects&catalog-import/04-plan-ajustes-limites-y-consultas.md), [fuente 06](../../docs/fonts/feature/projects&catalog-import/06-paginacion-y-limites.md), [bitácora 13 (GraphQL)](13-implementar-graphql.md).
Revisión de referencia: `78e99f3`, con los cambios de Neon y GraphQL aún sin commit.

## Necesidad y autorización

El usuario pidió ejecutar el plan de límites con evidencia para proteger las consultas y la base, y dejar fuera cualquier dependencia de Nuxt o Flutter para centrarse en el backend. Se retiraron esas menciones de los planes vigentes; la bitácora y las fuentes anteriores se conservan como historia.

## Cambios

- **`src/common/http/pagination.ts`**: único origen de límites (20 por defecto, 100 máximo), `PaginationQueryDto`, `resolvePage`, `fetchWindow` y `toPage`. `PaginationArgs` de GraphQL lo reutiliza.
- **Proyectos:** `ProjectsRepository.findAllByOwner` exige una ventana; `ProjectsService.findAll` aplica el valor por defecto y devuelve `{ items, page }`; `GET /projects` acepta `limit` y `offset` y responde `{ projects, page }`. El resolver GraphQL usa el mismo servicio.
- **Importaciones:** `GET /projects/:projectId/imports` (`CatalogImportService.list`, `CatalogImportRepository.listSnapshots`) y migración `20261030000100_index_catalog_snapshots_project`.
- **Una activa por proyecto:** `IMPORT_ALREADY_ACTIVE` (409). Comprobación temprana en `ImportAccessGuard` (`hasActiveJob`) y definitiva en `CatalogImportRepository.accept`, bajo el `FOR UPDATE` del proyecto.
- **Pruebas:** paginación REST con `hasMore` y rechazos, listado y 404 ajeno, 409 con trabajo activo (HTTP y repositorio), y `import-limits.spec.ts`, que compara `IMPORT_LIMITS` con los `CHECK` de la migración. Tres pruebas del worker que necesitan dos trabajos en cola del mismo proyecto los crean directamente con Prisma.
- **Documentación:** tabla de límites en el README; Nuxt y Flutter retirados de los planes vigentes.

## Comprobación

`pnpm build`, `pnpm lint`, `pnpm test:features` (203 pruebas, 14 suites), `db:verify` (3), `users:verify` (8) y `route-wiring` correctos. `db:migrate` aplicó el índice en Neon; `db:status` indica esquema al día y `db:check` devuelve `usersTableExists: true`.

## Decisiones y pendientes

- Sin índice parcial único para la regla de una importación activa: Prisma no lo representa y la transacción ya la garantiza.
- Cancelar trabajos y cuotas por usuario: descartados por ahora.
- Paginación por desplazamiento; por cursor queda como alternativa si las listas crecen.
- GraphQL no expone todavía el listado de importaciones.
