# 01 — NestJS Observe y cobertura del SDK

Fecha de creación: 2026-11-13  
Tipo de fuente: documentación oficial de NestJS  
Fecha de consulta: 2026-11-13  
Revisión de referencia: `3733be48a09be170df92d791a40c5d897e864b9f`, con cambios locales en curso.

## Pregunta de investigación

Qué se instala en la API ESM, qué funciona al instrumentar Nest y qué requiere comprobar o ampliar en KTSU.

## Evidencia

| Fuente y sección | Evidencia aplicable |
| --- | --- |
| [F1 · Overview, First project](https://docs.nestjs.com/observability/overview) y [FAQ, Can I use it with an existing app?](https://www.observe.nestjs.com/documentation/faq) | Observe es el APM gestionado de NestJS. El SDK se instala en la aplicación y envía al panel con credenciales de proyecto. La FAQ documenta los mínimos `@nestjs/core` 11.1.4 y `@nestjs/graphql` 13.4.4 cuando se usa GraphQL. |
| [F2 · SDK, Quick start; Authenticating and identifying the application; Shutdown](https://www.observe.nestjs.com/documentation/sdk) | `createObserveModule()` devuelve el módulo y su hook `ObserveInstrument`. El módulo se registra primero en el módulo raíz con `ObserveModule.forRoot()`, y el hook se pasa a `NestFactory.create()`. El SDK lee `OBSERVE_APP_KEY` y `OBSERVE_APP_SECRET`. `enabled: false` desactiva el registro y envío. Con shutdown hooks, el SDK limita el envío final con `shutdownFlushTimeout`. |
| [F3 · SDK, Database queries and outbound HTTP; Versioning deployments](https://www.observe.nestjs.com/documentation/sdk) | Observe instrumenta `pg` a nivel del driver, incluido el uso a través de adaptadores Prisma, y observa llamadas salientes por `fetch`. El SDK puede registrar SQL normalizado sin leer parámetros enlazados. `OBSERVE_SERVICE_VERSION` permite identificar explícitamente el release. |
| [F4 · Distributed tracing, HTTP to HTTP; GraphQL; Queue jobs](https://docs.nestjs.com/observability/distributed-tracing) | Observe usa un `X-Request-Id` válido cuando llega por HTTP o el SDK genera un ID para su traza. El comportamiento puede configurarse con `traceIdGenerator`. El SDK propaga el ID bajo las condiciones documentadas. Su integración de colas documenta Bull y BullMQ. |
| [F5 · Error monitoring, What is captured; Handled errors](https://docs.nestjs.com/observability/error-monitoring) y [Manual instrumentation, API summary](https://docs.nestjs.com/observability/manual-instrumentation) | Observe registra excepciones que salen del handler aunque exista un filtro de Nest. Un error recuperado dentro de la aplicación puede necesitar `TracerService.captureError()` dentro de una traza activa. Las métricas personalizadas pueden emitirse fuera de ella. |
| [F6 · OpenTelemetry, Running beside OpenTelemetry; Exporting spans over OTLP](https://docs.nestjs.com/observability/opentelemetry) | Observe está alojado por el proveedor. `openTelemetry` y OTLP son opcionales para integraciones. Observe puede exportar sus spans por OTLP y su panel carece de ingreso OTLP para spans de otros SDK. |

## Aplicación en KTSU

- La API declara Nest 12.0.3, GraphQL 14.1.0, Node 24, Express, `type: module` y Prisma con `@prisma/adapter-pg`. Son versiones declaradas en el [manifiesto](../../../package.json) y la [configuración NodeNext](../../../tsconfig.json). Verificar los *peer dependencies* y el artefacto ESM con la versión exacta del SDK elegida al implementar. [F1 · Compatibilidad](https://www.observe.nestjs.com/documentation/faq)
- Montar la instrumentación en el [bootstrap](../../../src/main.ts) y el [módulo raíz](../../../src/app.module.ts). Ambos deben usar el mismo par creado por la fábrica. La prueba de integración debe pasar por el mismo punto de arranque del contenedor. [F2 · Quick start](https://www.observe.nestjs.com/documentation/sdk)
- Verificar REST, el [GraphQL de Apollo](../../../src/graphql/graphql-config.ts), `pg` y el [cliente de IA](../../../src/knowledge/ai-service.client.ts) con casos sintéticos. El contrato público de errores lo determinan el [filtro de la API](../../../src/common/http/api-exception.filter.ts) y el formateador de Apollo. GraphQL puede devolver HTTP 200 con `errors[]`, por lo que se comprueba también el resultado de la operación. [F3 · SDK](https://www.observe.nestjs.com/documentation/sdk) · [F5 · Errores](https://docs.nestjs.com/observability/error-monitoring)
- Los workers usan polling propio sobre PostgreSQL y [WorkerLoop](../../../src/jobs/worker-loop.ts). Su aparición como jobs nativos del panel requiere evidencia específica. La primera señal operativa serán los registros de transiciones y métricas explícitas verificadas en un worker, reutilizando [QueueMonitor](../../../src/health/queue-monitor.ts). [F4 · Queue jobs](https://docs.nestjs.com/observability/distributed-tracing) · [F5 · API summary](https://docs.nestjs.com/observability/manual-instrumentation)
