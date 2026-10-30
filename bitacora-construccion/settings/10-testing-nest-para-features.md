# 10 — Testing Nest para nuevas features

Fecha de creación: 2026-10-25  
Estado: Implementado y verificado localmente para projects.  
Ámbito: configuración aislada Jest/Nest/Supertest y comprobación de projects.  
Relacionada con: [plan de testing](../../docs/plans/config/01-testing-nest-para-futuras-features.md), [guías verificadas](../../docs/fonts/config/02-reconstrucciones-verificadas-testing.md), [projects](../feature/projects&catalog-import/02-implementar-projects.md).  
Revisión de partida: `a551ed8`, con cambios locales anteriores.

## Evidencia y adaptación

Las guías R1/R2 y sus originales respaldan TestingModule/provide/useValue y configuración explícita de la app HTTP. Se adaptaron a ESM, Prisma y Descope actuales. Los mocks son nuevos por caso y se comprueban resultados y efectos. La cadena necesidad → original/pasaje → guía/fase → adaptación → archivo → prueba está en la [ficha 03](../../docs/fonts/config/03-implementacion-y-verificacion-testing.md).

Combinación ejecutada: Node 24.22.1, pnpm 12.5.1, TypeScript 6.0.3, Nest/testing 12.0.3, Jest/globals 30.5.2, Supertest 7.3.1 y Prisma 7.10.0. Se usa el runtime Node 24 de Codex, sin cambiar la instalación global.

## Cambios realizados

- [Jest](../../jest.features.config.mjs) separa unit/integration/e2e y solo descubre `test/features` compilado. [tsconfig.features](../../tsconfig.features.json) conserva ESM y metadatos sin globales Jest de producción.
- [compile-features](../../scripts/testing/compile-features.mjs) limpia `.test-build`, genera Prisma sin `.env` y compila. [watch](../../scripts/testing/watch-features.mjs) mantiene compilador y Jest y cierra ambos procesos al interrumpir. Los comandos nuevos están en package.json; cobertura en `coverage/features`.
- [Servicio](../../test/features/projects/projects.service.spec.ts): TestingModule real y colaboradores tipados pequeños. [Integración](../../test/features/projects/projects.repository.int-spec.ts): Prisma/pg, migración, restricciones y propiedad. [HTTP](../../test/features/projects/projects.e2e-spec.ts): módulo y guard reales, Supertest, DTOs y configuración compartida.
- [Soporte de base](../../test/features/support/test-database.ts): una instancia temporal por suite, pool local, migraciones con configuración aislada y limpieza. HTTP sustituye conexión y Descope antes de compile; cada caso limpia solo esa base temporal.
- El usuario pidió retirar la API anterior durante la ejecución: se eliminaron su suite específica y `spaces:verify`; el wiring Node conserva usuarios. El resto de suites Node y sus helpers siguen con su runner. La prueba histórica de migraciones ahora espera cuatro migraciones y la tabla final projects.

## Explicación del primer caso

Preparación: el doble devuelve un proyecto llamado «Resultado del doble» y Nest lo inyecta al servicio. Ejecución: `service.findAll(alice)`. Comprobación: UsersService recibe la identidad, el repositorio recibe el ID local y el servicio devuelve exactamente el proyecto controlado. Esto comprueba que la dependencia se utiliza, además de resolverla.

## Verificación

| Comando/comprobación | Resultado final |
| --- | --- |
| `pnpm install --frozen-lockfile` | Correcto; builds opcionales de watcher/resolver deshabilitados, binarios precompilados funcionales. |
| `pnpm test:features:unit` | 11 casos aprobados. |
| `pnpm test:features:unit --testNamePattern='lista usando'` | Caso aislado aprobado; 10 omitidos por filtro. |
| `pnpm test:features:cov` | 3 suites, 46 casos aprobados: 11 unitarios, 10 de integración y 25 HTTP. |
| Cobertura V8 de projects | 98,01 % líneas/sentencias, 97,01 % ramas, 100 % funciones. Servicio: 100 %. Se usa como diagnóstico, sin umbral artificial. |
| Watch con compilador y Jest | Arranque sin errores, ejecución de suites y cierre mediante Ctrl+C, sin forceExit. |
| `pnpm build` y `pnpm lint` | Correctos; el build productivo no contiene tests ni módulos retirados. |
| `node --test test/*.test.mjs` tras build | 11 regresiones Node aprobadas. |
| Prettier de archivos nuevos/afectados | Correcto. `pnpm format:check` global detecta una línea en blanco previa al final de `src/auth/auth.module.ts`; ese cambio ajeno no se modifica. |
| Enlaces locales de documentos vigentes modificados | 143 destinos revisados, ninguno ausente. |

Antes del cierre se introdujo temporalmente una expectativa falsa en cada grupo: lista vacía, lectura ajena no nula y POST 200. La ejecución conjunta dio **3 fallos y exit 1**, con referencias a las aserciones; se restauraron las tres y la suite volvió a aprobar. El ensayo se hizo antes de la retirada de compatibilidad; la suite final se repitió después de esa modificación y de añadir el POST autenticado sin cuerpo.

La primera ejecución con sockets fue bloqueada por el sandbox (`listen EPERM`); al habilitar ejecución local fuera de esa restricción pasó. Los recursos siguen siendo temporales y locales. No hubo migraciones remotas, login externo, despliegues ni credenciales volcadas en los resultados.

## Continuación y límites

La base sirve para CatalogImportModule y features posteriores. T2 requiere nuevas pruebas de parser, archivos, snapshots y jobs cuando se implementen. PGlite no acredita carga de Cloud SQL ni el doble de Descope acredita verificación criptográfica. El aviso de VM modules es esperado en Node 24. Las guías del curso permanecen como evidencia histórica independiente de estos resultados.
