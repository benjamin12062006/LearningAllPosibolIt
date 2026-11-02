# 01 — Serializador TSV de productos (E1)

Fecha de creación: 2026-11-01  
Estado: Implementado y verificado. Pruebas unitarias; la escritura en disco, la base de datos y HTTP corresponden a E4–E6.  
Ámbito: etapa E1 del [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md): función pura que convierte las filas válidas de una evaluación en `productos.tsv` (D4), con la comprobación de caracteres que Google no admite (base de D5). Sin Nest, Prisma, HTTP ni disco.  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md) (D4, D5, D8), [estado real](../../../docs/fonts/feature/reviews&exports/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../docs/fonts/feature/reviews&exports/02-fuentes-tecnicas.md), [cursos y reconstrucciones](../../../docs/fonts/feature/reviews&exports/03-cursos-y-reconstrucciones.md).  
Revisión de partida: `d5e8f54` en `main`, sin cambios de código; documentación de la feature sin commit.

## Necesidad y punto de partida

El usuario pidió empezar E1. No existía ningún módulo `exports` ni serializador TSV.

Línea base (medida el 2026-11-01 en la Fase 0): `pnpm test:features` → 25 suites y 425 pruebas en verde, con Node 26.9.0 (el de `pnpm`; `.nvmrc` fija 24.19.0, que no está instalada en este equipo).

No hizo falta investigación nueva: las decisiones salen de las fichas 01–02 y del plan.

## Evidencia y decisiones

Las decisiones vienen del plan; aquí se anota cómo se aplicaron y qué cambió al escribir el código.

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Serializador como función pura, separado del transporte (D4) | RC3 (cada reporte es una función que recibe datos y devuelve la definición), RC2 (el servicio construye y el controlador envía) | `buildProductsTsv(rows)` no lee hora, base ni disco, y devuelve `{ content: Buffer, rowCount }`. |
| Cabecera con nombres de atributo en inglés, un producto por línea, celdas vacías permitidas (D4) | F17, F20 | Cabecera `id` + atributos; la celda de un opcional sin valor queda vacía. |
| Sin tabulador final y mismo número de campos en todas las líneas (D4) | F18, F21 | Orden `id` → opcionales con valor (`condition`, `brand`) → obligatorios en el orden del perfil. La última columna es siempre `availability`, que nunca está vacía en una fila válida. |
| `\n` como fin de línea y UTF-8 sin BOM (D4) | F21 no fija el terminador; F17 no menciona el BOM | `LINE_END = '\n'` y `Buffer.from(…, 'utf8')` sin `U+FEFF`. Propuesta propia, pendiente de la cuenta piloto (D14). |
| Sin escape: un valor con tabulador, salto de línea o comilla inicial no se escribe (D4, D5) | F18, F19, F21; F26 descarta la mitigación OWASP | `assertFitsInTsv` lanza un error interno sin copiar el valor en el mensaje. |

### Ajustes al escribir el código

- **Dónde viven las comprobaciones de caracteres.** El plan proponía una sola función con nombre compartida con D5. Se escribieron dos predicados, `hasTabOrLineBreak` y `startsWithQuote`, en [google-merchant.profile.ts](../../../src/evaluations/engine/google-merchant.profile.ts) y no en `src/exports/`. Razón: `exports` dependerá de `evaluations`, no al revés, y E3 los usará desde el perfil. Son dos condiciones distintas, con motivos distintos (F18/F21 frente a F19), y cada una lleva su comentario. No cambian ninguna regla del perfil todavía: `findProductProblems` no los usa y `PROFILE_VERSION` no cambia hasta E3.
- **Más invariantes que el plan.** Además del carácter prohibido, el serializador rechaza una lista vacía (D1 garantiza al menos un válido) y un producto sin un atributo obligatorio. Las dos situaciones indicarían un error del backend, y escribir el archivo daría un TSV que Google rechazaría o con una línea terminada en tabulador.
- **Opcionales con solo espacios.** Para elegir columnas se usa `isBlank` del perfil: un `brand` que solo tiene espacios en todas las filas no crea columna. Si la columna existe por otra fila, el valor se escribe tal cual, sin recortarlo.
- **Cobertura.** Se añadió `src/exports/**` a `collectCoverageFrom` de [jest.features.config.mjs](../../../jest.features.config.mjs), como las demás features.

## Implementación y funcionamiento

| Decisión | Archivo y símbolo | Detalle |
| --- | --- | --- |
| D4 | [products-tsv.ts](../../../src/exports/products-tsv.ts), `buildProductsTsv` | Orquesta: elegir columnas, cabecera, una línea por fila y unión con `\n` final. |
| D4 | mismo archivo, `chooseColumns` | `id`, opcionales con algún valor no vacío y obligatorios en el orden de `PRODUCT_ATTRIBUTES`. El comentario explica por qué ese orden. |
| D4 | mismo archivo, `cellOf` | `id` desde `externalId`; un obligatorio vacío lanza error; un opcional ausente se escribe vacío. |
| D4, D5 | mismo archivo, `tsvLine` y `assertFitsInTsv` | Comprueban cada celda, también la cabecera, antes de unirlas con `\t`. |
| D5 (base) | [google-merchant.profile.ts](../../../src/evaluations/engine/google-merchant.profile.ts), `TAB_OR_LINE_BREAK`, `hasTabOrLineBreak`, `startsWithQuote` | `\t`, `\n`, `\r`, `\v`, `\f`, U+0085, U+2028 y U+2029; comilla solo al principio. |

Las filas deben llegar en orden de `sourceRow`: el serializador conserva el orden recibido. Lo garantizará la consulta de E5.

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| [products-tsv.spec.ts](../../../test/features/exports/products-tsv.spec.ts) (unitarias) | 31 pruebas en verde: orden de cabecera; opcionales omitidos (también con solo espacios); celda vacía intermedia; sin tabulador final y 9 campos por línea; un único `\n` final y sin `\r`; sin BOM y `é` en UTF-8; ceros del `id` y precio normalizado; comilla interior aceptada; mismos bytes con la misma entrada; errores por lista vacía, obligatorio vacío, cada uno de los 8 caracteres y comilla inicial en `id`, `title`, `description` y `brand`; predicados por separado. |
| Defectos introducidos a propósito, uno por uno, y restaurados con copia + `diff` sin diferencias | Quitar U+2028 de la expresión regular → 2 fallos. Obligatorios antes que opcionales → 4. Añadir BOM → 3. No comprobar obligatorios → 1. Comilla en cualquier posición → 2. `\r\n` como fin de línea → 4. |
| Cobertura de `src/exports/` | `products-tsv.ts`: 100 % de sentencias, ramas, funciones y líneas. |
| Medición `products-tsv-5000-rows` (sin cobertura) | 7, 9 y 7 ms; 1.538.952 bytes. 5.000 productos con descripciones de unos 200 caracteres y `brand`. En la misma ejecución completa, `errores.csv` midió 15 ms. |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | Sin errores. |
| `pnpm lint` (`oxlint --type-aware src/`) | Sin avisos, salida 0. |
| `./node_modules/.bin/prettier --check src test/features` y `jest.features.config.mjs` | Todo con el estilo de Prettier. |
| `pnpm test:features` | 26 suites y 456 pruebas en verde (425 previas + 31 nuevas). |
| `pnpm db:verify` | 3 de 3 (migraciones y conexión; pruebas locales, sin conectar a Neon). |

**Incidencia:** al escribir los archivos, los escapes `\u2028` y `\u2029` quedaron como caracteres literales (trampa 2 del traspaso). En JavaScript son finales de línea y rompieron la expresión regular (`prettier` lo detectó). Se sustituyeron por su escape con Python y se volvió a recorrer los archivos: el único carácter invisible que queda en `google-merchant.profile.ts` es un U+200D anterior, dentro del emoji de familia de un comentario.

**No verificado:**

- Que Google acepte el archivo (fin de línea `\n`, sin BOM, orden de columnas, extensión): exige la cuenta piloto (D14).
- Tiempo con Node 24.19.0 o en producción: la medición es en Node 26.9.0 dentro de Jest.

## Consecuencias y continuidad

- La medición confirma D8: serializar 5.000 productos cuesta milisegundos, así que la exportación puede hacerse dentro del POST.
- E2 escribirá la comprobación pura de la aprobación (D1–D3).
- E3 usará `hasTabOrLineBreak` y `startsWithQuote` en `findProductProblems`, con dos códigos de problema nuevos y una `PROFILE_VERSION` nueva.
- Cambios de esta etapa, sin commit: `src/exports/products-tsv.ts` (nuevo), `src/evaluations/engine/google-merchant.profile.ts` (dos predicados y una constante añadidos), `test/features/exports/products-tsv.spec.ts` (nuevo), `jest.features.config.mjs` (una línea).
