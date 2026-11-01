# 05 — Experimento: discriminador de reglas dentro del ValidationPipe real

Fecha de creación: 2026-10-31  
Tipo de fuente: experimento local con los paquetes instalados del proyecto, más una lectura de su código.  
Origen: `class-transformer@0.5.1`, `class-validator@0.15.1` y `@nestjs/common@12.0.3`, resueltos desde `node_modules` de la API.  
Fecha de consulta: 2026-10-31  
Revisión de referencia: `1f0be2d`, con cambios sin commit.  
Relacionada con: [fuentes técnicas, F16–F18](02-fuentes-tecnicas.md), [cursos, RC2–RC5 y C13](03-cursos-y-reconstrucciones.md), [plan 01, D3](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md), [experimentos](experimentos/).

## Necesidad

D3 dependía de dos supuestos que la documentación no cubre [F17, F18]:

1. Un `type` desconocido acaba como `RuleDto` y se rechaza en `rules.N.type`, siempre que se conserve el discriminador.
2. `forbidNonWhitelisted` rechaza los campos que no pertenecen a la subclase elegida.

El plan exigía confirmarlo (E2.0) antes de escribir el DTO.

## Método

Tres scripts en [experimentos/](experimentos/) crean las clases con los decoradores aplicados a mano, porque JavaScript plano no admite la sintaxis `@`. Después llaman a `ValidationPipe.transform()` con las opciones de [configure-http.ts](../../../../src/configure-http.ts) (l. 17–23): `transform`, `whitelist`, `forbidNonWhitelisted` y `validationError` sin `target` ni `value`. El `exceptionFactory` se sustituye por uno que devuelve los `ValidationError`, para poder leerlos.

- Se ejecutaron con Node 24.2.0 (`/opt/homebrew/bin/node`); el proyecto fija 24.19.0 y esa versión no está instalada en el equipo. `class-transformer` no depende de la versión menor de Node en este camino, pero el experimento no se repitió con 24.19.0.
- Las salidas completas están junto a cada script (`*.salida.txt`).

## Evidencia

| ID | Experimento | Resultado observado |
| --- | --- | --- |
| F27 | [01-discriminador.mjs](experimentos/01-discriminador.mjs) → [salida](experimentos/01-discriminador.salida.txt): `@Type(() => RuleDto, { discriminator, keepDiscriminatorProperty })` + `@ValidateNested({ each: true })` | Ver la lista que sigue a esta tabla. |
| F28 | [Código instalado](../../../../node_modules/.pnpm/class-transformer@0.5.1/node_modules/class-transformer/cjs/TransformOperationExecutor.js), l. 45 | `subTypes.find(subType => subType.name === subValue[discriminator.property])` lee la propiedad sin comprobar `null`. El [filtro global](../../../../src/common/http/api-exception.filter.ts) (`@Catch()`, l. 45; fallback 500 → `INTERNAL_ERROR`, l. 31) convierte ese `TypeError` en `500`. |
| F29 | [02-transform-manual.mjs](experimentos/02-transform-manual.mjs) → [salida](experimentos/02-transform-manual.salida.txt): sin discriminador; `@Transform(({ obj }) => …, { toClassOnly: true })` elige la subclase con un `Map` y llama a `plainToInstance`, y los valores que no son objeto pasan tal cual; además `@IsObject({ each: true })` | Ver la segunda lista, a continuación. |
| F30 | [03-type-simple.mjs](experimentos/03-type-simple.mjs) → [salida](experimentos/03-type-simple.salida.txt): `@Type(() => MappingDto)` sin discriminador, como en RC2 | `[null]` y `["x"]` → `mapping.0:nestedValidation`; un par válido da `MappingDto`. El fallo de F28 solo existe en la rama del discriminador. |

**Resultados de F27:**

- Las reglas válidas mixtas dan `CleanTextRuleDto` y `BuildTitleRuleDto`, con `type` conservado.
- Sin `keepDiscriminatorProperty`, incluso las reglas válidas fallan en `rules.N.type:isIn`, porque se borra `type`.
- Un `type` desconocido, ausente, numérico o `"__proto__"` falla en `rules.0.type:isIn`, y sus campos extra en `whitelistValidation`.
- Un campo de otra subclase falla en `rules.0.template:whitelistValidation`.
- Más de 20 reglas falla en `rules:arrayMaxSize`.
- **`rules: [null]` lanza `TypeError: Cannot read properties of null (reading 'type')`**, sin `ValidationError`.

**Resultados de F29:**

- Los casos de F27 producen los mismos errores.
- `[null]`, `["clean_text"]` y `[[…]]` dan `rules:isObject` + `rules.0:nestedValidation`, es decir, `400`.
- `type: "constructor"` y `"__proto__"` fallan en `isIn`: `Map.get` no recorre el prototipo.
- Ninguna excepción sale del pipe.

## Interpretación y límites

- Los dos supuestos de D3 se cumplen [F27]: con `keepDiscriminatorProperty: true` y `@IsIn` en la base, un tipo desconocido se rechaza, y `whitelist` funciona dentro de cada subclase.
- El discriminador de 0.5.1 **no es seguro con JSON válido**: `[null]` produce `500` en lugar de `400` [F27, F28]. Un cliente puede provocar errores internos registrados a voluntad, y el contrato del plan («400 en entradas inválidas») no se cumpliría.
- `@Transform` con despacho manual da el mismo resultado sin ese fallo [F29]. Su coste es una función propia de unas diez líneas, que hay que probar, en lugar de una opción declarativa.
- No se probó la serialización de vuelta (`instanceToPlain`) ni GraphQL. Solo cubre la entrada REST.
- Un experimento no es una prueba del proyecto: los casos se repetirán como pruebas unitarias del DTO en E2.

## Aplicación en el proyecto

D3 del plan cambia: despacho manual con `@Transform` + `@IsObject({ each: true })` + `@ValidateNested({ each: true })`, sin discriminador de `@Type`. `mapping` conserva el `@Type` simple de RC2 [F30]. Ver el [plan](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md).
