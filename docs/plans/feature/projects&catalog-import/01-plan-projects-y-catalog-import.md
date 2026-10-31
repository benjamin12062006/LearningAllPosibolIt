# 01 — Plan de inicio: projects y catalog-import

Fecha de creación: 2026-10-25  
Última actualización: 2026-10-26  
Estado: P0/T0/P1/C1–C3 implementados y verificados localmente; migraciones remotas, volumen de despliegue y U1 web pendientes.  
Ámbito: API NestJS; preparación del primer recorrido de catálogos.  
Relacionada con: [bitácora inicial](../../../../bitacora-construccion/feature/projects&catalog-import/01-preparacion-y-alineacion.md), [antecedentes](../../../fonts/feature/projects&catalog-import/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md), [testing futuro](../../config/01-testing-nest-para-futuras-features.md), [decisiones de producto](../../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md).  
Revisión de referencia: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales previos de PostgreSQL y retirada de Turso; no representa por sí sola todo el árbol inspeccionado.

## Objetivo observable

Un usuario autenticado crea o configura un proyecto propio, sube un CSV, elige su columna identificadora y consulta un snapshot completo con una muestra de sus filas. Si la entrada falla, recibe un motivo estable y no puede utilizar filas parciales. Este alcance cubre RF01, RF02, RF07, RNF01, RNF04 y RNF05 de los [requisitos](../../../../../docs-diagrams/05-analisis-y-requisitos.md).

## Punto de partida comprobado

La [bitácora auth/05](../../../../bitacora-construccion/auth/05-espacios-del-usuario.md) aporta propiedad desde la sesión y aislamiento. [Settings/02](../../../../bitacora-construccion/settings/02-prisma-migrate-y-statistical-spaces.md) registra Prisma y espacios persistentes. [Settings/06](../../../../bitacora-construccion/settings/06-conectar-nest-a-cloud-sql-postgresql.md), [07](../../../../bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md) y [09](../../../../bitacora-construccion/settings/09-retirar-turso-tras-guardar-restauracion.md) registran PostgreSQL y la retirada del proveedor anterior.

En la revisión inicial existían `auth`, `users`, `database` y espacios con nombre y GET/POST. Plan 02 añadió `projects` con configuración, detalle y PATCH y retiró la API anterior por instrucción del usuario. Plan 03 incorpora ahora la importación privada con snapshots y trabajos. Prisma 7.10.0 usa PostgreSQL y schema `estadistica_forms`; las claves y fechas siguen siendo texto. El alcance es solo el backend; cualquier interfaz queda fuera de este plan.

## Decisiones propuestas para implementar

| Necesidad | Decisión y razón | Evidencia |
| --- | --- | --- |
| Reutilizar lo construido | Reutilizar propiedad y datos; módulo, contrato y tabla final `projects`, mediante renombrado SQL que conserva filas. | [F1–F3: código e historial](../../../fonts/feature/projects&catalog-import/01-estado-real-y-antecedentes.md), [ejecución](../../../../bitacora-construccion/feature/projects&catalog-import/02-implementar-projects.md). |
| Preservar datos | Migración nueva y aditiva, conservando IDs, FK, índice y fechas; ningún reset ni edición del SQL aplicado. | [F4: Prisma v7](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md). |
| Espacios sin configuración | País, moneda y perfil nulos en filas heredadas; completar mediante PATCH antes de importar. Sin valores comerciales inventados. | Adaptación propia de RF01. |
| Retirada de API anterior | Eliminar módulos, rutas y tests específicos de espacios, sin adaptadores temporales. | Cambio solicitado por el usuario durante la implementación. |
| Un archivo válido y privado | `ArtifactStore` local con clave generada, límite durante recepción, hash y finalización antes del registro SQL. | [F5/F7: PostgreSQL y Nest](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md). |
| Importación controlada | Parser de streams, lotes, un trabajador en un proceso y trabajo persistido. Snapshot `ready` solo al terminar. | [F6/F8: restricciones y parser candidato](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md). |
| Recepción y compensación de archivos | Body multipart completo antes de aceptar, claves propias y limpieza fuera del controlador; ante commit incierto comprobar referencias antes de retirar el final. | [RC1–RC3: guías reconstruidas y adaptación](../../../fonts/feature/projects&catalog-import/03-cursos-y-reconstrucciones-catalog-import.md). |
| Aislamiento | Guard Descope → usuario local → proyecto propio → recurso hijo perteneciente al proyecto. | [F2/F3: implementación actual](../../../fonts/feature/projects&catalog-import/01-estado-real-y-antecedentes.md). |

La tabla física se renombra en la migración nueva y requiere despliegue coordinado con la API. El nombre público del producto es proyecto. La reutilización de datos no introduce todavía herramientas de agencias.

## Secuencia y criterios de avance

| Etapa | Resultado | Aceptación antes de avanzar | Documento |
| --- | --- | --- | --- |
| P0 — Base de regresión | Inventario de consumidores, estado de migraciones y pruebas existentes en entorno aislado. | Identificar cambios locales, conservar fixtures previos y verificar usuarios/espacios. | [02 — Projects](02-plan-projects.md) |
| T0 — Testing futuro | Configuración Jest y `@nestjs/testing` siguiendo el curso de Fernando Herrera; pruebas nuevas separadas de las actuales. | ESM, tipos, inyección y aislamiento de recursos comprobados; comandos existentes conservados. | [Configuración de testing](../../config/01-testing-nest-para-futuras-features.md) |
| P1 — Projects | Módulo reutilizado; crear, listar, consultar y configurar proyecto propio. | Alice no ve ni modifica Bob; datos heredados conservados; campos y contratos validados. | [02 — Projects](02-plan-projects.md) |
| C1 — Entrada y persistencia | Archivo privado, snapshot y trabajo `queued`; consultas de estado autorizadas. | `202` solo después de persistir; límites, configuración y propiedad controlados. | [03 — Catalog import](03-plan-catalog-import.md) |
| C2 — Procesamiento | Parser, filas originales, unicidad, estado `ready` y muestra. | CSV con ceros, comillas y saltos; duplicados y exceso fallan sin contenido parcial accesible. | [03 — Catalog import](03-plan-catalog-import.md) |
| C3 — Cierre operativo | Interrupciones, fallos de almacenamiento/DB, medición y documentación real. | Reinicio no deja trabajos eternamente `running`; estado/error estable; proceso de una instancia documentado. | [03 — Catalog import](03-plan-catalog-import.md) |
| U1 — Continuación web | Fuera del alcance del backend; se retoma por separado, si se decide. | — | [Fases](../../../../../docs-diagrams/03-fases-y-diagramas.md) |

Se puede implementar la pantalla de proyectos tras P1. La secuencia de código será P0 → T0 de configuración de testing → P1 con sus pruebas nuevas; después C1–C3. El usuario pide seguir el curso de testing de Fernando Herrera y reconstruir las lecciones pertinentes antes de adaptar su código.

## Organización documental y de código

Las tres áreas documentales comparten el subdirectorio literal `feature/projects&catalog-import/`. `01` de bitácora registra esta preparación; las siguientes entradas se abren al implementar incrementos y se completan con archivos y verificaciones reales. Las fichas en `fonts` no acreditan implementación.

Código previsto: `src/projects/` reutiliza controller/service/repository/DTO/module; `src/catalog-import/` contiene recepción, coordinación, repositorio, parser, trabajador y almacenamiento privado según se necesiten. `auth`, `users` y `database` se consumen por sus APIs existentes. No crear todas las carpetas o interfaces del producto antes de tener consumidor.

## Verificación prevista

Reutilizar como regresión `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm db:verify` y `pnpm users:verify`, manteniendo el runner de usuarios/conexión. La suite específica de espacios y su comando se retiraron con la API. Las nuevas suites de features usan Jest, `@nestjs/testing` y Supertest según el [plan de configuración](../../config/01-testing-nest-para-futuras-features.md), con comandos `test:features:*` independientes.

Las pruebas de migración deben cubrir base vacía y actualización de una base con usuarios/espacios heredados. Las comprobaciones HTTP incluyen sesión ausente, JWT inválido, acceso cruzado, DTO, carga real multipart y contrato `202` → consulta de trabajo. PGlite es la base aislada existente; no sustituye pruebas multiproceso de Cloud SQL. El login real con Descope se verifica aparte cuando se complete el recorrido web.

## Límites y decisiones de implementación

No incluye mapeo, reglas, evaluación comercial de productos, exportación TSV, conectores URL, programación, publicación, organizaciones, invitaciones, pagos o IA. La muestra de filas importadas no implica validez para Merchant Center.

Al implementar se fijará la versión del parser candidato, su compatibilidad con Node 24/ESM y los detalles de límites estructurales, retención y volumen privado. País/moneda del piloto se eligen explícitamente; se puede probar con fixtures declarados sin asignarlos a datos existentes. No se necesita cambiar de ORM, framework o motor de base para este recorrido.
