# 04 — C4: importar el máximo sin 500

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Implementado y verificado (sin medir en Neon).  
Relacionada con: [plan 01 de cierre](../../../docs/plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md) (P1, P8), [fuentes 01](../../../docs/fonts/feature/cierre-backend/01-estado-de-los-pendientes.md) (E1), [bitácora 04 de imports&exports](../imports&exports/04-puente-de-una-revision-al-catalogo.md) (hallazgo del arranque real), [bitácora C3](03-concurrencia-en-postgresql-real.md).  
Revisión de partida: `main` `c280506` más C1–C3 sin commit.

## Necesidad

Importar una hoja de 5.000 filas × 200 columnas (el máximo de [12]) por `POST …/worksheets/:id/imports` respondió 500 a los 6 s en PGlite: la transacción usa el plazo por defecto de Prisma (5 s). P1 pide medir por partes antes de decidir si se quita trabajo de la transacción o se sube el plazo.

## Medida por partes

Copia temporal del repositorio con marcas de tiempo (nunca en el código del repositorio). Hoja de 5.000 filas × 200 columnas (SKU y 199 de texto y decimal), CSV de 7 MB, importada en modo `append`; plazo de la transacción subido a 120 s solo en la copia, para poder medir sin que falle. 2026-11-08.

| Paso (ms) | PGlite, una conexión | PostgreSQL 15.2, contenedor de 2 CPU y 1 GiB |
| --- | ---: | ---: |
| Antes de la transacción (leer el CSV, mapear, convertir, comprobar) | 650 | 668 |
| Bloquear la organización y comprobar la cabecera | 1 | 3 |
| `JSON.stringify` de las operaciones (**48.609.111 bytes**) | 76 | 74 |
| `INSERT` del borrador con ese `jsonb` | **6.732** | **1.597** |
| Importación, auditoría y releer la importación | 6 | 8 |
| Releer el borrador para responder | 447 | 516 |
| **Transacción completa** | **≈ 7.300** | **≈ 2.200** |
| `POST …/imports` completo (respuesta de 48.623.870 bytes) | 8.155 | 3.095 |
| `submit` / `decisions` / `apply` | 2.243 / 1.161 / 2.122 | 2.561 / 1.254 / 2.029 |
| `GET …/changesets/:id` (48,6 MB) | 636 | 798 |

**Interpretación:**

- **El coste está en el tamaño del borrador, no en ningún paso mal hecho.** El CSV pesa 7 MB y las operaciones, 48,6 MB, porque cada operación `insert_row` guarda sus valores con el id de cada columna como clave: un millón de UUID de 36 caracteres. Guardar ese `jsonb` es la mayor parte de la transacción.
- **Las demás transiciones leen el borrador entero** (`lockChangeset` selecciona `operations`): enviar, aprobar y aplicar tardan de 1 a 2,6 s cada una con el máximo.
- **En PostgreSQL real cabe en 5 s, con poco margen.** En PGlite no cabe. En Neon los 48,6 MB viajan por la red dentro de la transacción; no se ha medido.

## Decisión concreta (sobre P1)

- **Quitar trabajo no alcanza sin cambiar contratos.** Releer el borrador (0,5 s) es lo único que se podría sacar sin tocar nada más, y no basta. Lo grande (guardar y leer 48,6 MB) solo baja si cambia el formato de las operaciones o si las respuestas dejan de devolver el borrador entero. Las dos cosas cambian contratos de E4 (el hash del contenido y las respuestas de `imports`, `submit` y `decisions`), así que no se hacen aquí: se proponen como decisión aparte.
- **Plazo con nombre para las transacciones que manejan un borrador entero:** `LONG_TRANSACTION_TIMEOUT_MS = 30_000`, más de cuatro veces la peor transacción medida (≈ 7,3 s en PGlite) y unas trece veces la de PostgreSQL real. Se aplica a crear una importación y a las transiciones de `ChangesetsRepository` que bloquean un borrador (`submit`, `reopen`, `cancel`, `rebase`, `decide`, `apply`, `markConflicted`). Crear un borrador a mano y guardarlo con `PUT` siguen con el plazo por defecto: su límite es de 1 MiB.

## Implementación

- `src/database/transaction-timeouts.ts` (nuevo): `LONG_TRANSACTION_TIMEOUT_MS = 30_000` y `LONG_TRANSACTION`, con la medida en su comentario.
- `src/worksheet-imports/worksheet-imports.repository.ts`: `create` cierra su transacción con `LONG_TRANSACTION`.
- `src/changesets/changesets.repository.ts`: `submit`, `reopen`, `cancel`, `rebase`, `decide`, `apply` y `markConflicted`, igual. `create` y `saveOperations` no cambian.
- Ningún contrato cambia: mismas rutas, cuerpos, respuestas y errores.

## Comprobaciones realmente ejecutadas

2026-11-08.

- **Recorrido del máximo con el código real**, sin instrumentar (importar 5.000 × 200, enviar, aprobar, aplicar y leer el borrador):

  | Petición | PGlite | PostgreSQL 15.2 |
  | --- | --- | --- |
  | `POST …/imports` | **201** en 9.437 ms (antes: 500 a los 6 s) | **201** en 2.985 ms |
  | `submit` | 200 en 2.117 ms | 200 en 2.401 ms |
  | `decisions` | 201 en 1.046 ms | 201 en 1.305 ms |
  | `apply` | 200 en 2.043 ms | 200 en 1.919 ms |
  | `GET` del borrador | 200 en 613 ms | 200 en 755 ms |

  El contenedor se arrancó para la medida y se paró al terminar.
- **Unitaria nueva** `test/features/database/long-transactions.spec.ts` (10 pruebas): el plazo es de 30 s; crear una importación y las siete transiciones lo usan; crear a mano y `PUT` no.
- **Suite completa** (PGlite): 87 suites y 1.459 pruebas pasan, y se saltan 5 (las de PostgreSQL). **`pnpm test:features:postgres`**: 5 de 5.
- `tsc`, `pnpm lint` y `prettier --check src test/features scripts/testing`: limpios.
- **Defectos a propósito** (copia limpia; pruebas del plazo, de borradores y de importaciones): importación sin plazo largo, `apply` sin plazo largo y plazo de 3 s. Los tres detectados.

## Consecuencias

- **El máximo de [12] ya se importa** en PGlite y en PostgreSQL.
- **Sin medir en Neon.** Allí los 48,6 MB del borrador viajan por la red dentro de la transacción. Además, la conexión tiene `query_timeout: 10_000` ([`postgresql.connection.ts`](../../../src/database/postgresql.connection.ts)): si una sola consulta con 48,6 MB tardara más de 10 s, fallaría aunque la transacción tenga 30 s. Medirlo exige escribir en Neon, así que queda para cuando el usuario lo autorice (por ejemplo, en una rama de Neon).
- **Propuesta aparte, porque cambia contratos de E4:** las operaciones de una importación ocupan siete veces el CSV, porque repiten el id de cada columna en cada fila, y `imports`, `submit`, `decisions` y `GET` devuelven el borrador entero (48,6 MB). Para la web de E7 conviene responder sin las operaciones, o paginarlas, y quizá guardarlas de forma más compacta. Cualquiera de las dos cosas cambia respuestas y el hash del contenido, así que se decide fuera de C4.
