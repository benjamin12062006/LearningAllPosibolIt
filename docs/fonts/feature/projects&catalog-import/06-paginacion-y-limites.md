# 06 — Paginación y límites de consulta

Fecha de creación: 2026-10-30  
Tipo de fuente: transcripciones y documentación oficial  
Origen: Fernando Herrera (`NestJS Backend Completo`); *NestJS Mastery* (`NestJS API Profesional`), como contraste; Prisma ORM.  
Fecha de consulta: 2026-10-30  
Relacionada con: [plan 04 de ajustes](../../../plans/feature/projects&catalog-import/04-plan-ajustes-limites-y-consultas.md), [fuentes técnicas](02-fuentes-tecnicas.md), [implementación de catalog-import](05-implementacion-catalog-import.md).

## Necesidad de consulta

`GET /api/v1/projects` devuelve todos los proyectos del propietario sin `LIMIT` ([ProjectsRepository.findAllByOwner](../../../../src/projects/projects.repository.ts)), y no existe ninguna ruta que liste las importaciones de un proyecto. Hacía falta elegir un contrato de paginación y validar sus parámetros.

## Localización verificable

| ID | Fuente | Líneas o sección | Frase de búsqueda |
| --- | --- | --- | --- |
| F1 | [97. Paginación de Pokemons](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/97. Paginación de Pokemons.md>) — `NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/` | 13–31 | «offset the limit», «carpeta de Common» |
| F2 | [98. Transform DTOs](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/98. Transform DTOs.md>) — misma sección | 13–25 | «enable explícita o implícita conversión» |
| F3 | [128. Get y Delete TypeORM](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 10 TypeORM - Postgres/128. Get y Delete TypeORM.md>) — `Sección 10 TypeORM - Postgres/` | 23 | «no queremos regresar miles de productos» |
| F4 | [72. Adding Pagination to Tasks List](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS API Profesional/Sección 6 Advanced Queries Search, Pagination & Filtering/72. Adding Pagination to Tasks List.md>) — `NestJS/NestJS API Profesional/Sección 6 .../` | 13–27 | «find and count», «meta» |
| F5 | [Prisma: Pagination](https://www.prisma.io/docs/orm/prisma-client/queries/pagination) | *Offset* frente a *cursor* | — |

## Evidencia

- **F1, l. 13–15:** se usan `limit` y `offset` opcionales como query params del mismo endpoint. **l. 23:** los query params llegan como strings y deben validarse como números positivos. **l. 27–29:** `PaginationDto` va en `common/` porque se reutiliza entre módulos; `limit` es opcional con mínimo 1 y `offset` es opcional con mínimo 0. **l. 31:** con `forbidNonWhitelisted`, los parámetros desconocidos se rechazan.
- **F2, l. 17:** `transform: true` con `enableImplicitConversion` convierte los tipos en el `ValidationPipe` global, a cambio de crear instancias y algo más de memoria. **l. 23–25:** el servicio aplica valores por defecto (`limit = 10`, `offset = 0`) y un orden estable.
- **F3, l. 23:** el curso deja anotado que no se deben devolver todos los registros porque pueden ser miles.
- **F4, l. 15–25 (contraste):** usa `skip` y `take` con `findAndCount` y devuelve `{ data, meta: { total, offset, limit } }`. Contar el total cuesta una consulta adicional.
- **F5:** *offset* es simple pero se vuelve más lento en páginas profundas. *Cursor* reanuda desde el último registro, solo admite ordenar por campos simples y exige un desempate único en el orden y en el cursor (por ejemplo, `id`). La página advierte que usar solo `createdAt` puede saltar o repetir registros.

## Interpretación y límites

- F1 y F2 dan el mecanismo base: un DTO de query común, validación y valores por defecto en el servicio. El curso no trata cuántos registros como máximo puede pedir un cliente; ese límite superior es una propuesta propia.
- El proyecto ya tiene `transform: true` sin `enableImplicitConversion` ([configure-http.ts](../../../../src/configure-http.ts)). Activar la conversión implícita global afectaría a todos los DTOs. **Propuesta:** convertir solo los campos de paginación con `@Type(() => Number)` de `class-transformer`.
- F5 describe la API de Prisma Client. Este proyecto usa `$queryRaw`, así que su principio se traduce a SQL: `ORDER BY created_at DESC, id DESC` con `LIMIT`. El índice `idx_projects_owner_created (owner_id, created_at DESC, id DESC)` ya cubre ese orden.
- Las fechas se guardan como `TEXT` ISO-8601 en UTC. El orden lexicográfico solo es correcto mientras el formato sea siempre el mismo; véase el [plan db/04](../../../plans/db/04-plan-migraciones-remotas-y-fechas.md).

## Aplicación en el proyecto

El [plan 04](../../../plans/feature/projects&catalog-import/04-plan-ajustes-limites-y-consultas.md) adopta `limit`/`offset` siguiendo a Fernando (F1, F2), con un máximo propio y metadatos `hasMore` sin `COUNT`. Deja la paginación por cursor (F5) como alternativa para listas que crezcan.
