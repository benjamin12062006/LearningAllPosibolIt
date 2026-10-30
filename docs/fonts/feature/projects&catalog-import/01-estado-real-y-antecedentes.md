# 01 — Estado real y antecedentes de projects y catalog-import

Fecha de creación: 2026-10-25  
Tipo de fuente: código local, bitácora histórica y requisitos del proyecto.  
Origen: API Nest, web Nuxt y `docs-diagrams`.  
Fecha de consulta: 2026-10-25  
Relacionada con: [plan general](../../../plans/feature/projects&catalog-import/01-plan-projects-y-catalog-import.md), [bitácora inicial](../../../../bitacora-construccion/feature/projects&catalog-import/01-preparacion-y-alineacion.md).  
Revisión inspeccionada: API `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35` con cambios locales previos. La raíz KSuT no es un repositorio Git; API y web tienen repositorios separados.

## Necesidad

Determinar qué se reutiliza antes de diseñar el primer incremento de catálogos, sin repetir la conexión a base ni atribuir a los diagramas funcionalidades implementadas.

## Fuentes consultadas y localizadores

Esta ficha conserva la inspección previa a la implementación. Las rutas de espacios retiradas se anotan como localizadores históricos; el estado vigente se registra en [implementación 04](04-implementacion-projects.md).

| ID | Fuente local y símbolo/sección | Evidencia observada |
| --- | --- | --- |
| F1 | [schema.prisma](../../../../prisma/schema.prisma), `datasource db`, `AppUser`, `StatisticalSpace`; [package.json](../../../../package.json), dependencies/scripts | PostgreSQL, schema `estadistica_forms`, Prisma 7.10.0, Nest 12.0.3 y SQL por cliente compartido. `StatisticalSpace` tiene ID, nombre, propietario y fecha. |
| F2 | Directorio histórico `src/statistical-spaces/`: controller/service `findAll/create`, repository `findAllByOwner/create`, DTO `CreateSpaceDto`. Archivos retirados durante Plan 02. | Guard Descope, usuario local, propietario derivado de identidad y SQL parametrizado. Solo GET/POST de colección; nombre recortado 1–120. |
| F3 | [auth/05](../../../../bitacora-construccion/auth/05-espacios-del-usuario.md), Necesidad e implementación; [settings/02](../../../../bitacora-construccion/settings/02-prisma-migrate-y-statistical-spaces.md); [settings/06](../../../../bitacora-construccion/settings/06-conectar-nest-a-cloud-sql-postgresql.md), Implementación; [settings/07](../../../../bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md), Migraciones/Estado final; [settings/09](../../../../bitacora-construccion/settings/09-retirar-turso-tras-guardar-restauracion.md), Verificación | Historia de propiedad, persistencia, transición PostgreSQL, pruebas remotas y retirada de Turso. Las pruebas descritas corresponden a sus fechas, no a esta revisión. |
| F9 | [main.ts](../../../../src/main.ts), `bootstrap`; [AppModule](../../../../src/app.module.ts); [contexto de pruebas](../../../../test/support/users-test-context.mjs), `createUsersTestContext`; suite histórica `test/statistical-spaces.test.mjs`, retirada durante Plan 02. | Prefijo `/api/v1`, ValidationPipe estricto, módulos reales, PostgreSQL temporal PGlite/socket y migraciones por Prisma CLI. |
| F10 | [producto](../../../../../docs-diagrams/01-producto-y-prototipo.md), alcance; [requisitos](../../../../../docs-diagrams/05-analisis-y-requisitos.md), RF01/RF02/RNF01; [dominio](../../../../../docs-diagrams/06-dominio-y-datos-postgresql.md), snapshots | Requisito de proyecto/CSV, IDs de texto y versiones completas. Los documentos se actualizan en esta misma entrega y son especificación, no evidencia de ejecución. |
| F11 | [Nuxt](../../../../../estadistica-forms-web/nuxt.config.ts), configuración; [servicio de perfil](../../../../../estadistica-forms-web/app/services/profile.ts), `createProfileService`; [controlador de acceso](../../../../../estadistica-forms-web/app/services/access-controller.ts), `createAccessController` | Existe flujo de sesión/perfil web; la búsqueda en `app/` no encontró consumo de espacios. No acredita ausencia de clientes externos. |

F4–F8 y F12–F16 se reservan en la [ficha técnica](02-fuentes-tecnicas.md), para evitar colisiones de referencias en los planes. Las lecciones y guías posteriores del importador usan C1–C3/RC1–RC3 en su [ficha de reconstrucciones](03-cursos-y-reconstrucciones-catalog-import.md).

## Interpretación y adaptación

La reutilización principal es la propiedad privada y la persistencia de un contenedor con nombre. Convertirlo en proyecto exige configuración de tienda y nuevas operaciones; un cambio de etiqueta no satisface RF01. Es una inferencia del código F1/F2 y los requisitos F10.

Propuesta propia: `Project` mapeado inicialmente a `statistical_spaces`, configuración nullable en heredados, ruta pública nueva y puente temporal de rutas antiguas. El importador será feature separada que depende del acceso a proyecto. Estas decisiones no se atribuyen a cursos ni existen aún como código.

Las lecciones de Fernando Herrera y otras referencias citadas en auth/05 son antecedentes documentados por esa entrada. En esta preparación no se consultaron ni reconstruyeron sus originales, por lo que no se presenta una nueva atribución al instructor. El historial orienta qué conservar; el código y las futuras pruebas deciden si sigue funcionando.
