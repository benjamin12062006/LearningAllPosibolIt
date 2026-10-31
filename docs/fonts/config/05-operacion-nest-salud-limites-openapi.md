# 05 — Operación Nest: salud, límite de peticiones y OpenAPI

Fecha de creación: 2026-10-30  
Tipo de fuente: transcripciones y documentación oficial  
Origen: Fernando Herrera (`NestJS Backend Completo`, `Microservicios con NestJS`); NestJS docs.  
Fecha de consulta: 2026-10-30  
Relacionada con: [plan de análisis de operación](../../plans/config/03-plan-analisis-operacion-backend.md).

## Necesidad de consulta

Antes de desplegar o hacer un piloto, la API no tiene health check, límite de peticiones ni documentación OpenAPI, y escucha fijada en `127.0.0.1` ([main.ts](../../../src/main.ts)). Hacía falta ver qué cubren los cursos y la documentación vigente.

## Localización verificable

| ID | Fuente | Localizador |
| --- | --- | --- |
| F1 | [194. Nestjs swagger - OpenAPI Specification](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 14 Documentación - OpenAPI/194. Nestjs swagger - OpenAPI Specification.md>) — `NestJS/NestJS Backend Completo/Sección 14 Documentación - OpenAPI/` | l. 13–15; la sección continúa en las lecciones 195–198 (Tags, ApiProperty, ApiResponse, DTOs). |
| F2 | [189. Health-check - Controlador y módulo](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Microservicios con NestJS/Sección 16 GCloud - Kubernetes Engine/189. Health-check - Controlador y módulo.md>) — `NestJS/Microservicios con NestJS/Sección 16 GCloud - Kubernetes Engine/` | l. 13–17 |
| F3 | Sección 9 *Variables de entorno - Deployment y Dockerizar* (lecciones 103–115) y sección 16 *Desplegar toda la aplicación a producción* (216–221) de `NestJS Backend Completo` | Solo se inventariaron los títulos; no se leyeron. |
| F4 | [NestJS: OpenAPI introduction](https://docs.nestjs.com/openapi/introduction) | `@nestjs/swagger`, `DocumentBuilder`, `SwaggerModule.createDocument` y `setup` |
| F5 | [NestJS: Health checks (Terminus)](https://docs.nestjs.com/recipes/terminus) | `@nestjs/terminus`, `HealthCheckService`, `PrismaHealthIndicator`, `DiskHealthIndicator` |
| F6 | [NestJS: Rate limiting](https://docs.nestjs.com/security/rate-limiting) | `@nestjs/throttler`, `ThrottlerModule.forRoot`, `ThrottlerGuard`, adaptación a GraphQL |

## Evidencia

- **F1, l. 13–15:** Fernando propone generar la documentación a partir de los controladores mediante la especificación OpenAPI, que no depende del lenguaje.
- **F2, l. 13–17:** antes de desplegar en Google Cloud, crea un endpoint *Health Check* en la raíz porque la plataforma consulta la aplicación para saber si está viva.
- **F4:** el documento se construye con `DocumentBuilder`, se genera con `SwaggerModule.createDocument` y se monta con `SwaggerModule.setup`. Se recomienda pasar una función para generarlo en la primera petición.
- **F5:** `HealthCheckService` combina indicadores y solo informa «up» si todos lo están. Terminus incluye `PrismaHealthIndicator` (la página no da un ejemplo) y `DiskHealthIndicator.checkStorage` con umbral por porcentaje o por bytes.
- **F6:** `ThrottlerModule.forRoot({ throttlers: [{ ttl, limit }] })` registra la configuración (`ttl` en milisegundos) y `ThrottlerGuard` se aplica de forma global con `APP_GUARD`. Para GraphQL hay que sobrescribir `getRequestResponse()`.

## Interpretación y límites

- F2 es un despliegue de microservicios en Kubernetes. Aquí solo se transfiere la necesidad de una ruta de salud consultable por la plataforma, no la arquitectura.
- F3 no se ha leído. Antes de planificar el despliegue concreto, sus lecciones deben consultarse como originales.
- No se consultó ninguna fuente sobre cabeceras de seguridad (por ejemplo, Helmet). Si se incluyen, necesitan su propia fuente antes de decidirse.
- `PrismaHealthIndicator` no tiene ejemplo en F5. Con la conexión actual (Cloud SQL Connector, `pg` y `$queryRaw`), comprobar con `SELECT 1` es una alternativa que debe verificarse.

## Aplicación en el proyecto

Base del [plan de análisis de operación](../../plans/config/03-plan-analisis-operacion-backend.md). Cada capacidad que se decida implementar tendrá su propio plan y, si procede, sus reconstrucciones.
