# 04 — Evidencia de implementación de projects

Fecha de creación: 2026-10-25  
Tipo de fuente: código local, migración y ejecución de pruebas.  
Relacionada con: [antecedentes](01-estado-real-y-antecedentes.md), [plan 02](../../../plans/feature/projects&catalog-import/02-plan-projects.md), [bitácora 02](../../../../bitacora-construccion/feature/projects&catalog-import/02-implementar-projects.md), [testing](../../config/03-implementacion-y-verificacion-testing.md).

| Fuente y localizador | Comportamiento demostrado |
| --- | --- |
| [ProjectsController](../../../../src/projects/projects.controller.ts), [DTOs](../../../../src/projects/projects.dto.ts) | POST/GET colección y GET/PATCH por ID, envelopes, guard, UUID y validación estricta. |
| [ProjectsService](../../../../src/projects/projects.service.ts) | Usuario local autenticado, acceso propio, actualización completa de configuración y requisito de configuración para la importación posterior. |
| [ProjectsRepository](../../../../src/projects/projects.repository.ts) | SQL parametrizado sobre `estadistica_forms.projects`; filtros de propietario en lectura y escritura. |
| [Schema](../../../../prisma/schema.prisma) y [migración nueva](../../../../prisma/migrations/20261025000100_configure_projects/migration.sql) | Modelo Project, renombrado de tabla/índice/restricciones y columnas/checks de configuración. Sin recrear tabla ni modificar SQL histórico aplicado. |
| [Tests de integración](../../../../test/features/projects/projects.repository.int-spec.ts) | Base vacía migrada, repetición de deploy, actualización de base previa conservando IDs/nombres/propietarios/fechas, integridad y acceso cruzado. |
| [Tests HTTP](../../../../test/features/projects/projects.e2e-spec.ts) | Configuración/contrato/autorización reales y rutas anteriores retiradas con 404. |

El usuario retiró expresamente la compatibilidad prevista inicialmente. Se eliminaron los directorios de espacios y el adaptador temporal, sus peticiones, suite específica y comando. Las migraciones históricas se conservan porque son necesarias para actualizar la base ya existente y reproducir una instalación vacía.

La validación de códigos usa los decoradores ISO de [class-validator](https://github.com/typestack/class-validator#validation-decorators), ejecutados desde la versión instalada. Normalizar trim/mayúsculas y admitir el perfil interno `google_merchant` son decisiones propias; no acreditan elegibilidad comercial de todos los países ISO.

La [fuente técnica F4](02-fuentes-tecnicas.md) respalda preparar una migración personalizada que conserva datos. El renombrado físico se incorporó al cambio solicitado por el usuario, sustituyendo la propuesta de mantener el nombre anterior. Las restricciones SQL complementan DTOs, no sustituyen autorización.

Los resultados y sus límites se registran en bitácora; no se aplicó esta migración a Cloud SQL. La congelación de configuración al existir snapshots corresponde a Plan 03 y todavía no está implementada.
