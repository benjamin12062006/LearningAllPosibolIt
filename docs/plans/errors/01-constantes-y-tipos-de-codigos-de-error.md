# 01 — Constantes y tipos derivados para códigos de error

Fecha de creación: 2026-10-28
Estado: Ejecutado y verificado; propuesta y alcance conservados
Ámbito: API, catálogo bilingüe y emisores de errores públicos
Relacionada con: [fuentes TypeScript](../../fonts/types/01-tipos-derivados-y-codigos-de-error.md), [contrato anterior](../config/02-mensajes-y-errores-bilingues-es-en.md), [ejecución](../../../bitacora-construccion/types/01-constantes-y-tipos-de-error.md)
Revisión de referencia: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios previos conservados.

## Objetivo

Escribir `apiError(ErrorCodes.PROJECT_NOT_FOUND)` y disponer de un objeto real
con todos los códigos, un tipo derivado de sus valores y un catálogo completo
comprobado con `satisfies`. Conservar códigos, estados y mensajes es/en actuales.

## Punto de partida

`src/common/http/messages.ts` contiene `API_MESSAGES`, `LocalizedMessage`,
`ErrorCode = keyof typeof API_MESSAGES` e `isErrorCode`. Las funciones `apiError`,
`publicError` y `ApplicationFailure` ya aceptan ese tipo, pero emisores, filtros,
validación y parser usan literales. Los tests usan cadenas para comprobar el
contrato público; esas expectativas sirven como evidencia independiente.

La bitácora de mensajes bilingües registra la normalización histórica JSONB y los
estados HTTP existentes. Hay numerosos cambios locales ajenos: no se revertirán,
no se creará commit y no se modificarán backend, frontend o base fuera de este
incremento de tipos y sus consumidores necesarios.

## Fuentes y decisiones

La [ficha de fuentes](../../fonts/types/01-tipos-derivados-y-codigos-de-error.md)
relaciona originales F1–F7 y reconstrucciones R1–R6 del curso de Maximilian
Schwarzmüller, además del contraste oficial F8.

| Decisión | Fuente y aplicación |
| --- | --- |
| Objeto `ErrorCodes` con `as const` | F1/R1 y F8: trasladar inferencia literal del ejemplo de roles a códigos públicos. |
| Tipo `(typeof ErrorCodes)[keyof typeof ErrorCodes]` | F4/R4, F5/R5, F6/R6 y F8: derivar claves y después valores. |
| Claves calculadas y `satisfies Record<ErrorCode, { status: number; message: LocalizedMessage }>` | F2/R2, F3/R3 y F8: comprobar cobertura y estructura del catálogo. |
| Guard de entrada `unknown` basado en valores de ErrorCodes | Adaptación propia: la comprobación estática no valida valores externos. |
| Mantener imports previos de ErrorCode/isErrorCode desde messages mediante reexportación | Decisión propia de compatibilidad; código de producción usará el módulo canónico. |

Se elige un módulo `src/common/http/error-codes.ts` independiente del catálogo:
evita que el tipo derive circularmente del catálogo que debe validar. No se usa
enum ni un generador permanente; el objeto es la declaración explícita de códigos.
No se introduce un tipo nominal para rechazar literales válidos: la intención es
usar constantes en la aplicación y conservar una unión compatible con el contrato.

## Incrementos

1. Conservar una referencia temporal del catálogo y del código inicial para
   comparar exclusivamente este cambio; inventariar todos sus códigos y usos.
2. Crear `error-codes.ts` con constantes, tipo de valores y `isErrorCode`.
3. Actualizar `API_MESSAGES` con claves calculadas y `satisfies`; conservar sus
   textos y estados, y reexportar los símbolos anteriores por compatibilidad.
4. Sustituir los literales del catálogo en `src/`: auth, usuarios, proyectos,
   importación, parser, worker, filtros y validación. Mantener ajenos los códigos
   del sistema operativo, Multer y logs que no pertenezcan al catálogo público.
5. Verificar compilación, formato, lint y suites existentes; contrastar el
   catálogo completo antes/después y comprobar diagnósticos negativos de tipos.
6. Completar la bitácora con cambios, evidencia, resultados y límites; relacionar
   el resultado desde este plan sin atribuir ejecución a una propuesta previa.

## Comprobación prevista

- Verificar que los valores de ErrorCodes y las claves del catálogo coinciden y
  que todas las entradas conservan exactamente estado, es y en.
- Comprobar con TypeScript el rechazo de propiedad inexistente, código inválido,
  catálogo incompleto, entrada extra y estructura sin traducción requerida.
- Verificar el guard ante códigos desconocidos y nombres heredados de Object;
  reutilizar y, si es necesario, ampliar puntualmente la prueba del catálogo.
- Ejecutar build, lint, formato y las suites existentes de features, que cubren
  mensajes, HTTP y errores persistidos con PostgreSQL temporal. No usar credenciales
  ni bases remotas para esta refactorización.

## Límites y continuidad

Sin cambios de rutas, políticas de autorización, traducciones, persistencia,
dependencias o contratos de éxito. `as const` aporta readonly al tipo, no un
Object.freeze en ejecución. El objeto de códigos conserva strings en JavaScript.
La revisión del autocompletado en WebStorm queda a cargo del usuario; la
compilación y sus diagnósticos comprueban los nombres de propiedades disponibles.

## Resultado de ejecución

El plan se ejecutó el 2026-10-28. La [bitácora 01](../../../bitacora-construccion/types/01-constantes-y-tipos-de-error.md)
registra el módulo de constantes, la migración de consumidores, la igualdad de
las 54 entradas del catálogo y las comprobaciones reales. Pasaron build, lint,
formato, 180 pruebas de features, 11 regresiones Node y seis casos negativos de
TypeScript además del caso válido. No quedan incrementos pendientes de este plan.
