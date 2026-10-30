# 01 — Constantes y tipos derivados de códigos de error

Fecha de creación: 2026-10-28
Estado: Implementado y verificado
Ámbito: Tipos y usos de códigos públicos del backend
Relacionada con: [plan 01](../../docs/plans/errors/01-constantes-y-tipos-de-codigos-de-error.md), [fuentes del curso](../../docs/fonts/types/01-tipos-derivados-y-codigos-de-error.md), [mensajes bilingües anteriores](../settings/11-mensajes-y-errores-bilingues.md)
Revisión de partida: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales previos conservados.

## Necesidad y decisión

El usuario pidió investigar el curso de Maximilian Schwarzmüller, reconstruir las
lecciones pertinentes, crear el plan y ejecutarlo. El tipo anterior ya restringía
los códigos; este incremento añade las constantes reales para que sus usos dejen
de depender de cadenas escritas manualmente.

La [ficha](../../docs/fonts/types/01-tipos-derivados-y-codigos-de-error.md) conserva
la cadena F1/R1 → literales con `as const`; F4/R4 + F5/R5 + F6/R6 → unión derivada
de valores; F2/R2 + F3/R3 → catálogo completo mediante `satisfies Record`.
F8 contrasta la sintaxis oficial. El diseño de errores es adaptación propia del
proyecto y no se atribuye literalmente al curso.

## Punto de partida verificado

Se inventariaron 54 códigos en el catálogo y 20 consumidores con literales.
`apiError`, `PublicError`, `ApplicationFailure` y los mapas de validación ya
aceptaban `ErrorCode`; el tipo derivaba de las claves de `API_MESSAGES`.
Había cambios previos staged en esas áreas. Se comparó el contenido leído antes
de editar y se conservaron todos los cambios ajenos; no se hizo commit ni staging.
El catálogo leído coincide con el blob del índice Git
`4ce848110bd8f4b75e6308579b5561a3073adc99`, que permite recuperar el contenido
exacto de partida aunque el commit HEAD todavía no incluya el sistema bilingüe.

## Implementación y funcionamiento

| Fuente o decisión | Archivo y símbolo implementado | Adaptación |
| --- | --- | --- |
| F1/R1: inferencia literal con `as const` | [error-codes.ts](../../src/common/http/error-codes.ts), `ErrorCodes` | Declara los 54 códigos como propiedades con sus valores públicos anteriores. |
| F4/R4 + F5/R5 + F6/R6 y F8: typeof, keyof y acceso indexado | Mismo módulo, `ErrorCode` | `(typeof ErrorCodes)[keyof typeof ErrorCodes]` extrae los valores; el objeto existe en ejecución y el alias solo en comprobación estática. |
| F2/R2 + F3/R3 y F8: Record y satisfies | [messages.ts](../../src/common/http/messages.ts), `API_MESSAGES` | Usa `[ErrorCodes.X]` y `satisfies Record<ErrorCode, { status: number; message: LocalizedMessage }>` para exigir cobertura y estructura. |
| Guard para entrada externa; decisión propia | [error-codes.ts](../../src/common/http/error-codes.ts), `isErrorCode` | Un Set de valores reales reconoce únicamente strings conocidos. No depende de las propiedades heredadas de Object ni supone que todo string sea ErrorCode. |
| Conservar imports anteriores; decisión propia | [messages.ts](../../src/common/http/messages.ts) | Reexporta ErrorCode/isErrorCode desde su módulo canónico, evitando romper imports previos. La aplicación usa el módulo canónico. |
| Aplicación transversal del plan | [apiError](../../src/common/http/api-error.ts), [publicError](../../src/common/http/public-error.ts), [filtro HTTP](../../src/common/http/api-exception.filter.ts), [validación](../../src/common/http/validation-errors.ts), [transporte](../../src/common/http/transport-errors.ts) | Sustituye literales y conserva normalización, orden de incidencias, mensajes, clases de excepciones y estados. |
| Misma unión de valores en los emisores | Auth, users y projects; [parser](../../src/catalog-import/csv-parser.ts), [repositorio](../../src/catalog-import/catalog-import.repository.ts), [servicio](../../src/catalog-import/catalog-import.service.ts), [worker](../../src/catalog-import/catalog-import.worker.ts), [upload](../../src/catalog-import/import-upload.interceptor.ts) y [almacén](../../src/catalog-import/artifact.store.ts) | Emplean ErrorCodes en errores HTTP, ImportFailure, errores guardados y logs que ya compartían un código del catálogo. |

Ejemplo de uso real:

```ts
import { ErrorCodes } from '../common/http/error-codes.js';
import { apiError } from '../common/http/api-error.js';

throw apiError(ErrorCodes.PROJECT_NOT_FOUND);
```

Flujo final: propiedad de ErrorCodes → valor string estable → apiError/publicError
→ estado y mensajes desde API_MESSAGES → respuesta HTTP o error JSONB. Los datos
externos pasan por isErrorCode antes de indexar el catálogo.

No se añadieron al catálogo los códigos ENOENT/EACCES/EPERM/EIO, códigos Multer,
estados de jobs ni identificadores internos como IMPORT_ORPHAN_RETAINED o
IMPORT_FAILURE_RECORD_PENDING: son otros contratos. El inventario final no
encuentra ningún literal de los 54 códigos públicos en `src/` fuera de la
declaración única `error-codes.ts`.

Para añadir un código se incorpora su propiedad al objeto y su entrada bilingüe
al catálogo. TypeScript señala la entrada pendiente o incompatible. Para usarlo,
se importa ErrorCodes y se selecciona su propiedad; no se escribe otra unión a mano.

## Comprobación ejecutada

| Comprobación | Resultado observado |
| --- | --- |
| `reconstruction.py draft/render/verify/install` | Seis recetas/guías, siete originales incluyendo contexto. Frases, líneas y hashes válidos; lectura semántica por el agente e instalación de seis guías sin sobrescrituras. No equivale a ejecutar el curso. |
| `pnpm build` | Correcto: generación Prisma y compilación Nest. |
| `pnpm lint` | Correcto: oxlint con comprobación de tipos. |
| `pnpm format:check` y Prettier del test modificado | Correctos. |
| `pnpm test:features` | 11 suites, 180 pruebas correctas: unitarias, integración y e2e. |
| `node --test test/*.test.mjs` | 11 regresiones correctas. |
| Comparación profunda del catálogo compilado con referencia anterior a la edición | Las 54 claves, estados, textos es/en y valores de ErrorCodes coinciden exactamente. La reexportación de isErrorCode conserva la misma función. |
| [Prueba del catálogo ampliada](../../test/features/http/messages.spec.ts) | Cubre correspondencia y unicidad de códigos, aceptación de todos sus valores y rechazo de desconocidos, datos no string y `constructor`/`toString`/`__proto__`. Se conservaron literales en las expectativas anteriores para contrastar el contrato público. |
| Comprobación temporal con TypeScript sobre módulos reales | Caso válido sin diagnósticos; los seis casos negativos de la tabla siguiente producen los errores esperados. |
| Inventario final, diff enfocado y enlaces documentales | Sin literales públicos duplicados en src, sin errores de whitespace en archivos del incremento, secuencias 01 sin colisiones y enlaces de ficha/plan/bitácora existentes. |

Diagnósticos reales de TypeScript `6.0.3`:

| Entrada incorrecta | Diagnóstico observado |
| --- | --- |
| `ErrorCodes.PROJECT_NOT_FOND` | TS2551: propiedad inexistente. |
| String desconocido asignado a ErrorCode | TS2820: valor no asignable, con sugerencia. |
| Catálogo sin INVALID_UUID | TS1360: falta una propiedad requerida. |
| Catálogo con UNKNOWN_CODE extra | TS2353: propiedad desconocida. |
| Entrada de INVALID_UUID sin traducción en | TS2741: falta la propiedad en. |
| Reasignar ErrorCodes.PROJECT_NOT_FOUND | TS2540: propiedad readonly. |

Se usó Node `26.9.0`, disponible en este entorno, sin cambiar los engines del
proyecto, que siguen indicando Node 24. La compilación, los tests y los diagnósticos
se ejecutaron contra las dependencias instaladas.

El primer intento de features en sandbox obtuvo EPERM al escuchar en localhost
(100 pasaron y 80 no pudieron ejecutarse). Se repitió con permiso para sockets
locales y las 180 pasaron. La primera comprobación temporal de tipos se ajustó para
admitir su fixture fuera de rootDir; después se observaron todos los diagnósticos
previstos. No se cambió tsconfig para resolver esas limitaciones del harness.

Las suites de persistencia usaron PostgreSQL temporal PGlite/socket, y HTTP y disco
locales. No se cargaron credenciales ni se accedió a Cloud SQL o Descope. Los logs
de fallos controlados y el aviso experimental ESM de Jest son esperados.

## Consecuencias y límites

El [plan](../../docs/plans/errors/01-constantes-y-tipos-de-codigos-de-error.md) quedó
ejecutado. No cambian códigos de red, traducciones, estados, rutas, DTOs, contratos
de éxito, lógica de negocio ni esquema SQL. Los JSONB antiguos siguen siendo
normalizados por el mismo código público. No se añadieron dependencias.

La unión ErrorCode conserva la compatibilidad estructural: un literal válido aún
es aceptado por TypeScript. No se implementó una prohibición de lint ni un tipo
nominal; el código de producción actual sí usa exclusivamente las constantes para
estos códigos. `as const` aporta readonly al tipo y no congela el objeto en runtime.

No se automatizó WebStorm para observar el menú de autocompletado. La existencia
de las propiedades y el rechazo de nombres mal escritos se verificaron con el
compilador. Las reconstrucciones fieles quedan separadas de la adaptación a Nest.
