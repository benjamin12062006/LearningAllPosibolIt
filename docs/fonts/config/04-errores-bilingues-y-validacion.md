# 04 — Contrato bilingüe, filtros y validación

Fecha de creación: 2026-10-26  
Tipo de fuente: Documentación oficial, código instalado y elaboración propia.  
Fecha de consulta: 2026-10-26  
Relacionada con: [plan 02](../../plans/config/02-mensajes-y-errores-bilingues-es-en.md), [bitácora 11](../../../bitacora-construccion/settings/11-mensajes-y-errores-bilingues.md).

## Evidencia y adaptación

| Fuente consultada | Evidencia | Aplicación |
| --- | --- | --- |
| F1: [Nest — Exception filters](https://docs.nestjs.com/exception-filters), apartados excepciones HTTP, filtros globales y captura completa | `HttpException` permite obtener estado/respuesta; un filtro global recibe fallos anteriores y posteriores al controller. | [ApiExceptionFilter](../../../src/common/http/api-exception.filter.ts) conserva estados y regenera mensajes controlados, con 500 genérico para errores desconocidos. |
| F2: [class-validator](https://github.com/typestack/class-validator), ValidationError y validación anidada | Las reglas están en `constraints`, con `children` para anidación; `target` y `value` contienen datos recibidos. | [validationIssues](../../../src/common/http/validation-errors.ts) traduce identificadores de regla, recorre hijos, deduplica y ordena; no usa el texto de constraints ni publica valores. |
| F3: paquetes instalados Nest 12.0.3, `ValidationPipe`, `ParseUUIDPipe`, `ExpressAdapter.mapException` | Los pipes aceptan `exceptionFactory`. El adaptador puede envolver errores de parsing y perder su tipo original. | [configureHttp](../../../src/configure-http.ts) registra los parsers del adaptador y [transportErrors](../../../src/common/http/transport-errors.ts) antes de su normalización, para mapear `.type` sin interpretar frases. |

La página web de técnicas de validación de Nest no respondió durante la consulta; no se atribuye evidencia a esa página. Se verificaron las APIs instaladas y su comportamiento con Nest/Supertest real. Las versiones efectivas son Node 24.22.1, Nest 12.0.3, TypeScript 6.0.3 y Jest 30.5.2.

El diseño `code` más `message: { es, en }`, los códigos concretos y la normalización de JSONB son decisiones del proyecto aprobadas por el usuario. No se atribuyen al curso de Fernando Herrera. El [plan de testing](../../plans/config/01-testing-nest-para-futuras-features.md) sigue aportando la organización de las pruebas futuras, sin convertir las suites Node existentes.

## Código y comprobación

[messages.ts](../../../src/common/http/messages.ts) es la matriz tipada código/estado/es/en. [public-error.ts](../../../src/common/http/public-error.ts) crea mensajes independientes y normaliza errores guardados por código, descartando textos anteriores. No se necesita paquete de internacionalización ni migración SQL.

Las [pruebas del catálogo](../../../test/features/http/messages.spec.ts) comprueban cada entrada, aislamiento y errores históricos; las [pruebas HTTP](../../../test/features/http/errors.e2e-spec.ts) comprueban DTOs, UUID, JSON, tamaño, charset, rutas, errores desconocidos y éxito. Los resultados completos y los límites se registran en la bitácora enlazada.
