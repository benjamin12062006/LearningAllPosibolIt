# 03 — Implementación y evidencia del testing de projects

Fecha de creación: 2026-10-25  
Tipo de fuente: código local, ejecución de pruebas y adaptación de guías revisadas.  
Relacionada con: [plan](../../plans/config/01-testing-nest-para-futuras-features.md), [R1/R2 y originales](02-reconstrucciones-verificadas-testing.md), [bitácora 10](../../../bitacora-construccion/settings/10-testing-nest-para-features.md).

## Cadena de evidencia aplicada

| Necesidad | Original y guía reutilizada | Adaptación en la API | Verificación |
| --- | --- | --- | --- |
| Inyección y dobles pequeños | Clase 80, líneas 19 y 29–33; R1 fases 1/3, E2/E6/E7/E8. Los enlaces completos al original y la guía están en la ficha 02. | [projects.service.spec.ts](../../../test/features/projects/projects.service.spec.ts): servicio real, `provide/useValue`, `module.get`, dobles tipados nuevos en cada beforeEach. | Resultado controlado, llamada con propietario local, denegación sin escritura y cierre del módulo. |
| HTTP con pipes efectivos | Clase 51 y contexto 50; R2 fases 1–3, E3–E9. | [projects.e2e-spec.ts](../../../test/features/projects/projects.e2e-spec.ts) y [configureHttp](../../../src/configure-http.ts): módulo real, Supertest y configuración compartida antes de init. | POST sin cuerpo con sesión válida da 400; nominal da 201; DTOs, CORS, versión, guard y aislamiento cubiertos. |
| Persistencia real y aislamiento | Adaptación del contexto PostgreSQL temporal del proyecto; no código atribuido al curso. | [test-database](../../../test/features/support/test-database.ts), configuración Prisma local separada, proveedor de conexión sustituido antes de compile. | Prisma migrate deploy, SQL/constraints/FK, renombrado conservando filas y cero destinos remotos. |
| ESM y compilación | [Nest testing](https://docs.nestjs.com/fundamentals/testing), [Jest ESM](https://jestjs.io/docs/ecmascript-modules) y código efectivo del proyecto. | [tsconfig](../../../tsconfig.features.json), [Jest](../../../jest.features.config.mjs), compilación TypeScript previa y flag VM modules. | Tipos, metadatos e imports `.js` resueltos; prueba aislada y suite conjunta ejecutadas. |

Se reutilizan las dos guías ya generadas, contrastadas e instaladas; no se inventa una nueva reconstrucción ni se atribuyen Prisma/Descope al ejemplo del instructor. La verificación del helper y sus manifiestos permanece registrada en la ficha 02, separada de la ejecución real de la API.

## Combinación efectiva

Node 24.22.1, pnpm 12.5.1, TypeScript 6.0.3 resuelto, Nest y `@nestjs/testing` 12.0.3, Jest y `@jest/globals` 30.5.2, Supertest 7.3.1, `@types/supertest` 7.2.1, Prisma 7.10.0. Las nuevas dependencias se fijan exactamente y el lockfile registra la combinación. Sin ts-jest ni cambio a CommonJS.

La compilación limpia únicamente `.test-build`, genera el cliente sin leer `.env` y compila las fuentes y specs. Las suites tienen discovery separado por sufijo; los tipos Jest se importan explícitamente. `watch` compila TypeScript y observa el resultado con Jest; `cov` usa V8 y escribe en `coverage/features`.

Las dependencias opcionales `@parcel/watcher` y `unrs-resolver` tienen builds deshabilitados en pnpm; los binarios precompilados instalados permiten resolver Jest y ejecutar watch en este equipo. El aviso experimental de VM modules es el de Node 24.

## Límites

La frontera Descope está controlada; el guard y el resto del recorrido son reales. No acredita login ni verificación criptográfica externa. PGlite/socket verifica SQL PostgreSQL local, no carga concurrente de Cloud SQL. La migración remota y las pruebas de importación siguen pendientes. Los resultados completos y la prueba deliberadamente fallida se registran en la bitácora 10.
