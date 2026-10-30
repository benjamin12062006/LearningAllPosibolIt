# 02 — Reutilizar statistical-spaces como projects

Fecha de creación: 2026-10-25  
Última actualización: 2026-10-26  
Estado: Implementado y verificado localmente; migración remota pendiente. Alcance actualizado por el usuario: retirar la API anterior, sin compatibilidad temporal.  
Ámbito: RF01/UC01 y RF07; API y persistencia de proyectos.  
Relacionada con: [plan general](01-plan-projects-y-catalog-import.md), [importación dependiente](03-plan-catalog-import.md), [estado y antecedentes](../../../fonts/feature/projects&catalog-import/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md).  
Revisión de referencia: `a551ed8`, con cambios locales previos; ver detalle en el plan general.

## Resultado buscado

Un proyecto representa una tienda con nombre, país, moneda y perfil de canal; pertenece al usuario autenticado. El usuario crea, lista, consulta y configura sus proyectos. Los espacios existentes conservan identidad y requieren completar configuración antes de importar.

## Reutilización por responsabilidad

| Actual | Destino | Cambio previsto |
| --- | --- | --- |
| `StatisticalSpacesModule` | `ProjectsModule` | Registrar la feature en `AppModule` y exportar `ProjectsService` para importación. |
| `StatisticalSpacesController` | `ProjectsController` | `/projects`; añadir lectura por ID y PATCH. Retirar las rutas anteriores. |
| `StatisticalSpacesService` | `ProjectsService` | Resolver usuario local, autorizar proyecto y validar configuración. |
| `StatisticalSpacesRepository` | `ProjectsRepository` | Conservar SQL parametrizado; añadir detalle/actualización con `id` y `owner_id`. |
| `CreateSpaceDto` | DTOs de proyecto | Nuevo POST exige `name`, `country`, `currency`, `channelProfile`; DTO legado mantiene `name`. |
| `StatisticalSpace` de Prisma | `Project` | `@@map("projects")` y `@@schema("estadistica_forms")`; renombrar tabla, índice y restricciones conservando filas. |

Se reutilizan los mecanismos documentados en [auth/05](../../../../bitacora-construccion/auth/05-espacios-del-usuario.md); la implementación vigente es [ProjectsRepository](../../../../src/projects/projects.repository.ts). Son antecedentes, no una investigación nueva de cursos; si hace falta desarrollar un mecanismo nuevo desde una clase, consultar el original antes de atribuirle la decisión.

Para las pruebas nuevas rige el [plan de configuración de testing](../../config/01-testing-nest-para-futuras-features.md): Jest + `@nestjs/testing` + Supertest, con las reconstrucciones pertinentes de Fernando Herrera. El usuario pidió después eliminar toda la compatibilidad de espacios: se retiraron su suite específica, peticiones, comando y referencias de wiring. Los tests de usuarios y conexión mantienen su runner Node. Esta decisión sustituye la propuesta inicial de fachadas.

## Datos y migración aditiva

Conservar `id`, `name`, `owner_id`, `created_at`, FK e índice. Añadir `country`, `currency`, `channel_profile` como texto nullable para filas heredadas. Añadir un CHECK de configuración: los tres están ausentes o los tres están completos; checks adicionales de forma y perfil admitido. La API valida códigos de país/moneda contra una lista soportada, no solo longitud. `channelProfile` inicial: `google_merchant`, identificador interno propio, no un código de Google.

Los proyectos nuevos de `/projects` requieren los tres campos; las filas anteriores migradas pueden carecer de ellos. `configurationStatus` se calcula como `ready` o `required`; no hace falta persistir un segundo estado que pueda contradecir columnas. Los GET incluyen campos nulos cuando corresponda. Un recurso sin configuración completa no admite importación (`409 PROJECT_CONFIGURATION_REQUIRED`).

1. Revalidar las tres migraciones actuales y preparar un fixture con usuarios y espacios antes del cambio.
2. Cambiar el nombre lógico de Prisma y preparar una migración nueva con `ALTER TABLE ... RENAME`, renombrado de restricciones/índice y columnas/checks. Revisar que no haya DROP/CREATE.
3. Aplicar en base temporal, verificar igualdad de IDs, propietarios, nombres y fechas y completar configuración mediante el servicio.
4. Regenerar cliente, actualizar repositorios y wiring, y ejecutar regresiones.
5. Documentar despliegue de la migración nueva; `migrate dev` se usa en base de desarrollo aislada. La aplicación remota futura usa el procedimiento ya existente, sin reset ni edición de checksums previos.

Esta estrategia adapta las [migraciones personalizadas de Prisma v7](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations). El renombrado físico acompaña al cambio de API; coordinar migración y despliegue antes de arrancar la versión nueva. Los tres SQL históricos se conservan para instalaciones existentes y nuevas.

## Contrato HTTP propuesto

| Operación | Entrada | Salida |
| --- | --- | --- |
| `POST /api/v1/projects` | Nombre 1–120 tras trim, país, moneda, perfil. | `201 { project }`, configuración completa. |
| `GET /api/v1/projects` | Sesión; sin `ownerId` seleccionable. | `200 { projects }`, orden actual fecha/ID descendente. |
| `GET /api/v1/projects/:id` | ID y sesión. | `200 { project }` o `404` ausente/ajeno. |
| `PATCH /api/v1/projects/:id` | Nombre opcional y/o terna completa de configuración; rechazar cuerpo vacío. | `200 { project }`; sin transferencia de propiedad. |

`project` expone `id`, `name`, `country`, `currency`, `channelProfile`, `configurationStatus` y `createdAt`; no expone credenciales ni tipos Prisma. Se preserva el guard y se rechazan campos extra como `ownerId`. La terna de configuración se actualiza junta; una vez que existe un snapshot se bloqueará cambiar país/moneda/perfil en este incremento (`409 PROJECT_CONFIGURATION_LOCKED`). Renombrar el proyecto sigue permitido. Versionar esta configuración llegará cuando lo exija evaluación reproducible.

`ProjectsService` exportará una operación de resolución del proyecto propio y otra de comprobación de configuración para `catalog-import`. Las actualizaciones siempre filtran propietario en SQL; el importador verifica además que cada snapshot/job pertenece al proyecto de la ruta. Validar el formato de un UUID no sustituye autorización.

## Aceptación y verificación prevista

- Base previa con dos usuarios y espacios: migrar sin pérdidas y sin inventar configuración.
- Nuevo POST: configuración válida, campos extra rechazados, propietario derivado de sesión.
- Alice lista y consulta solo sus recursos; consultar o actualizar el ID de Bob devuelve `404` y no cambia datos.
- PATCH completa un heredado; terna incompleta, país/moneda no soportados o perfil desconocido devuelven `400`.
- Importación posterior rechaza configuración pendiente; congelación de configuración se verifica al añadir snapshots.
- Rutas anteriores retiradas: GET/POST responden 404. La tabla final e índice se llaman projects; los IDs anteriores se conservan.
- Wiring Nest y pruebas de usuarios continúan aprobando; verificar contrato HTTP además del servicio.

Las verificaciones nuevas se implementarán como suites de feature, con dobles pequeños para servicios y Prisma/PostgreSQL temporal para repositorios. La suite HTTP mantiene guards reales y controla únicamente la frontera Descope, conforme al plan de testing. Los scripts Node actuales sirven como regresión sin reescritura.

Al cerrar este incremento, abrir/completar `02` de la bitácora temática con cambios y resultados reales. El siguiente paso es C1 del [plan de importación](03-plan-catalog-import.md); si se aborda la UI, crear su entrada en la bitácora web.

## Cierre de implementación

Implementación en `src/projects`; pruebas nuevas en `test/features/projects`. Resultado inicial: [bitácora 02](../../../../bitacora-construccion/feature/projects&catalog-import/02-implementar-projects.md) y [testing 10](../../../../bitacora-construccion/settings/10-testing-nest-para-features.md). La protección `PROJECT_CONFIGURATION_LOCKED` se incorporó y verificó al ejecutar [Plan 03](03-plan-catalog-import.md), con transacción y bloqueo de proyecto compartidos por PATCH y aceptación.
