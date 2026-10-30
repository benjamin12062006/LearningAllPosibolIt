# 11 — Mensajes públicos y errores bilingües de la API

Fecha de creación: 2026-10-26  
Estado: Implementado y verificado.  
Ámbito: B0–B4 del plan de mensajes es/en, adopción transversal y pruebas.  
Relacionada con: [plan 02](../../docs/plans/config/02-mensajes-y-errores-bilingues-es-en.md), [testing](10-testing-nest-para-features.md), [importador](../feature/projects&catalog-import/03-implementar-catalog-import.md).  
Revisión de partida: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales anteriores conservados.

## Inventario y decisión

El usuario ordenó ejecutar el plan antes guardado. Auth, usuarios, proyectos e importación aún emiten textos propios; importación tiene un filtro local y errores JSONB que también pueden contener mensajes antiguos. Se centralizarán códigos y traducciones, validación y filtro HTTP, conservando reglas y estados.

El servicio web de perfil consulta statusCode y construye sus propios mensajes de UI: no interpreta el cuerpo de error de la API. El controlador web muestra esos errores locales. No se requiere modificar pantallas para adoptar este contrato en el backend; selección visual de idioma queda como continuación del cliente. El inventario local no acredita ausencia de consumidores externos.

El diseño bilingüe es decisión del proyecto. Se consultaron filtros de excepciones de Nest, class-validator y las APIs instaladas de ValidationPipe/ParseUUIDPipe. La documentación web de validación no estuvo disponible durante la consulta; se contrastará el comportamiento ejecutándolo contra los paquetes del proyecto.

## Verificación

| Comprobación ejecutada | Resultado |
| --- | --- |
| `pnpm build` | Correcto, incluido Prisma generate. |
| `pnpm lint` | Correcto, sin advertencias finales. |
| `pnpm format:check` | Correcto. |
| `pnpm test:features:cov` | 11 suites, 179 casos correctos; cobertura de líneas 97,84% en Projects, importación y base HTTP; base HTTP 98,89%. |
| `node --test test/*.test.mjs` | 11 regresiones correctas con runner Node. |

Se ejecutaron con Node 24.22.1 y dependencias locales, sin `.env` en las nuevas suites, usando PostgreSQL temporal PGlite/socket, disco temporal y HTTP local. No se aplicaron migraciones remotas ni se accedió a Cloud SQL. Los logs de fallos controlados y el aviso ESM experimental de Jest son esperados. La cobertura no incluye todos los módulos del proyecto ni acredita proveedores externos.

Las nuevas [pruebas del catálogo](../../test/features/http/messages.spec.ts) recorren todos los códigos, verifican ambas traducciones, independencia de objetos y normalización histórica. Las [pruebas del filtro HTTP](../../test/features/http/errors.e2e-spec.ts) comprueban 409 de negocio, 500 seguro, estado estándar alternativo, ruta 404, JSON mal formado, 413 por cuerpo excesivo, charset 415, DTOs ausentes/nulos/extra, orden de incidencias, UUID y éxito sin envoltorio nuevo.

Se ampliaron las suites reales de [Projects HTTP](../../test/features/projects/projects.e2e-spec.ts) para comprobar auth 401, recurso ajeno 404 y perfil ausente 404 bilingües; mantienen guard, servicios y persistencia reales. La [integración del importador](../../test/features/catalog-import/catalog-import.repository.int-spec.ts) comprueba lectura bilingüe de errores JSONB antiguos en job y snapshot sin reescribirlos. Solo se ajustaron aserciones y fixtures afectados; los nombres de tests y el runner anterior se conservaron.

## Implementación y decisiones

La [ficha de fuentes 04](../../docs/fonts/config/04-errores-bilingues-y-validacion.md) relaciona documentación oficial, APIs instaladas y decisiones propias. La matriz completa estado/código/es/en queda en [messages.ts](../../src/common/http/messages.ts), evitando duplicar un catálogo que podría desactualizarse.

| Área | Decisión implementada |
| --- | --- |
| [apiError](../../src/common/http/api-error.ts) | Construye excepciones Nest por código; conserva clases estándar y estados de negocio. |
| [ApiExceptionFilter](../../src/common/http/api-exception.filter.ts) | Normaliza todos los errores HTTP y genera `requestId` interno; no publica mensajes de proveedores ni SQL. Los estados estándar sin código propio tienen un código genérico; estados adicionales como 418 conservan su estado con `HTTP_ERROR`. |
| [Validación](../../src/common/http/validation-errors.ts) | Traduce reglas por identificador y parámetros UUID; incidencias ordenadas, sin duplicados, sin target ni valores recibidos. |
| [Transporte](../../src/common/http/transport-errors.ts) | Mapea tipos del parser Express antes de su simplificación por Nest; no compara frases. |
| Auth/users/projects | Códigos explícitos; conserva 401/404/409 y reglas de propiedad. |
| [Importación](../../src/catalog-import/catalog-import.module.ts) | Retira el filtro particular y reutiliza el global; parser y worker usan `ApplicationFailure` y mensajes centrales. |
| [Errores guardados](../../src/common/http/public-error.ts) | Nuevos fallos guardan es/en. Los históricos se reconstruyen al leer por código, descartando texto guardado; código desconocido usa `IMPORT_PROCESSING_FAILED`. Conserva ubicación y correlación admitidas. |

Una excepción desconocida es 500 `INTERNAL_ERROR`, incluido el fallo inesperado tras aceptación de importación. Los errores explícitos de almacenamiento, aceptación incierta y base de datos siguen siendo 503 con sus códigos; el estado del job sigue siendo el mecanismo para consultar importaciones aceptadas. Un job fallido consultado correctamente devuelve HTTP 200 con su `error` bilingüe embebido, porque la consulta en sí tuvo éxito.

Cada error HTTP contiene `statusCode`, `code`, `message: { es, en }`, `requestId` y, si aplica, `issues`. Se regeneran mensajes desde el catálogo; nunca se traduce una frase arbitraria. `Accept-Language` no altera el contrato: ambas traducciones están siempre disponibles. El identificador de correlación de importación se conserva cuando existe; no se toma un identificador arbitrario del cliente.

## Compatibilidad y continuación

Se conserva `/api/v1` y las respuestas exitosas `{ project }`, `{ projects }`, `{ user }`, `{ identity }` y de importación. No existen confirmaciones humanas exitosas que necesiten traducción en este incremento. Nuevas features deben reutilizar la base común y añadir códigos con ambas traducciones.

Se inspeccionó `estadistica-forms-web/app/services/profile.ts`: decide por estado y crea sus propios mensajes de UI, de modo que no requiere modificación. Consumidores externos que traten `message` como string deben adaptarse antes de publicar. La selección visual de idioma del cliente, las traducciones de pantallas y los logs quedan fuera de este contrato.

No se requiere migración SQL, nuevo paquete, despliegue ni cambio de tests a otro runner. El [plan 02](../../docs/plans/config/02-mensajes-y-errores-bilingues-es-en.md) queda cerrado; los cambios locales anteriores se conservaron sin crear commits.
