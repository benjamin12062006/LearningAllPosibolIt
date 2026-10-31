# 02 — Curso Nest: semillas y eliminación

Fecha de creación: 2026-10-30  
Tipo de fuente: transcripción  
Origen: Fernando Herrera, *Nest: Desarrollo backend escalable con Node* (`NestJS Backend Completo`).  
Fecha de consulta: 2026-10-30  
Relacionada con: [plan de semillas](../../plans/db/02-plan-semillas-de-desarrollo.md), [plan de eliminación](../../plans/db/03-plan-eliminacion-de-datos.md), [documentación Prisma](03-documentacion-prisma-seed-y-acciones-referenciales.md).

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones`. Cada lección es un único Markdown con párrafos largos; las líneas se verificaron con `nl -ba`. No se generaron reconstrucciones: estos documentos son planes y no implementan código.

## Necesidad de consulta

El proyecto no tiene semillas ni rutas `DELETE`, y todas sus claves foráneas usan `ON DELETE RESTRICT`. Hacía falta saber cómo enseña el curso principal la semilla, el borrado de un registro y el borrado con relaciones.

## Localización verificable

| ID | Lección y ruta | Líneas | Frase de búsqueda |
| --- | --- | --- | --- |
| F1 | [90. Crear módulo SEED](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/90. Crear módulo SEED.md>) — `NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/` | 13–23 | «precarga mi base de datos», «código destructivo» |
| F2 | [128. Get y Delete TypeORM](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 10 TypeORM - Postgres/128. Get y Delete TypeORM.md>) — `Sección 10 TypeORM - Postgres/` | 31–33 | «Si no se encuentra producto» |
| F3 | [146. Eliminación en cascada](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 11 Relaciones en TypeORM/146. Eliminación en cascada.md>) — `Sección 11 Relaciones en TypeORM/` | 13–27 | «creáramos una transacción», «imágenes huérfanas» |
| F4 | [147. Product Seed](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 11 Relaciones en TypeORM/147. Product Seed.md>) — `Sección 11 Relaciones en TypeORM/` | 13–35 | «borrar todos los productos anteriores», «exportarlo en ese módulo» |

## Evidencia

- **F1, l. 15:** la semilla sirve para que un desarrollador nuevo tenga datos de prueba y para recuperar la base tras un código destructivo en desarrollo. **l. 17–23:** se genera un recurso `seed` sin entidad, con un único `GET` que llama a `SeedService.execute`. La lógica queda en el servicio, no en el controlador.
- **F2, l. 31–33:** el borrado individual busca primero con `findOne` (que lanza `NotFoundException`) y después llama a `repository.remove`. Valida el ID con `ParseUUIDPipe`.
- **F3, l. 13–15:** borrar un producto con imágenes falla por la restricción de la clave foránea. Hay dos salidas: una transacción que borra primero las imágenes y luego el producto, o una cascada. **l. 17:** el instructor dice que la transacción sería lo recomendable por el control que da, y elige la cascada porque la tabla es simple. **l. 19–21:** descarta `SET NULL` para no dejar imágenes huérfanas. **l. 23–27:** crea `deleteAllProducts`, un borrado masivo que llama «bastante destructivo» y que solo debería permitirse en desarrollo o bajo condición.
- **F4, l. 13–15:** antes de insertar, la semilla borra lo existente para poder repetirse sin choques de unicidad. **l. 27–33:** para usar `ProductsService` desde `SeedModule`, `ProductsModule` exporta el servicio y `SeedModule` importa el módulo.

## Interpretación y límites

- El curso usa TypeORM, MongoDB/PostgreSQL, Postman y un endpoint HTTP de semilla. Este proyecto usa Prisma 7, SQL parametrizado y Descope. La organización por servicios y la exportación entre módulos se pueden transferir; el endpoint `GET /seed` no.
- La semilla del curso es destructiva: «borrar todo y volver a insertar». Aquí no se puede borrar toda la tabla, porque comparte esquema con datos reales cuando el destino es Cloud SQL.
- El curso no trata archivos asociados a los registros. En este proyecto, `catalog_snapshots.artifact_key` apunta a archivos privados que PostgreSQL no puede borrar en cascada.
- La autorización por propietario no aparece en estas lecciones (se ve más adelante, en la sección 13). El filtro `owner_id` es un requisito de este proyecto ([ADR06](../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md)).

## Aplicación en el proyecto

- **Adaptación (F1, F4):** la semilla vive en un componente aparte y reutiliza servicios o repositorios en lugar de duplicar SQL. **Propuesta propia:** ejecutarla como comando CLI (`prisma db seed`), no como ruta HTTP; véase la [ficha 03](03-documentacion-prisma-seed-y-acciones-referenciales.md).
- **Adaptación (F2):** buscar bajo el propietario antes de borrar y responder `404` si el recurso no existe o es ajeno, igual que las lecturas actuales.
- **Adaptación (F3):** combinar los dos caminos que el curso presenta. Cascada para los hijos que no tienen sentido por sí solos (filas y trabajos del snapshot) y una transacción explícita para el borrado del proyecto. Se mantiene `RESTRICT` como red de seguridad en las relaciones superiores.
