# 04 — Módulo común de artefactos y escritura del TSV (E4)

Fecha de creación: 2026-11-01  
Estado: Implementado y verificado. Pruebas unitarias, de integración y E2E, comparación diferencial con el oráculo y arranque real de `AppModule`. Todavía no hay quien escriba TSV: lo hará E5.  
Ámbito: etapa E4 del [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md) (D6): extraer `ArtifactStore` de `catalog-import` a `src/artifacts/` sin cambiar su comportamiento, añadir la carpeta `exports/` con una escritura verificada y extraer la lógica de huérfanos para reutilizarla.  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md) (D6), [bitácora 03](03-perfil-de-google-v2026-11-01.md), [cursos y reconstrucciones](../../../docs/fonts/feature/reviews&exports/03-cursos-y-reconstrucciones.md) (RC1, RC3, RC6, C10), [plan de evaluaciones](../../../docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md) (D8).  
Revisión de partida: `d5e8f54` con los cambios sin commit de E1–E3. Oráculo de la comparación: `d5e8f54`, donde `artifact.store.ts` y `artifact-cleanup.service.ts` eran idénticos a los de partida.

## Necesidad y punto de partida

El usuario pidió empezar E4. Tras E3: 27 suites y 519 pruebas en verde.

No hay commit de punto de guardado porque el usuario no ha pedido commits. Como `ArtifactStore` y su limpieza no habían cambiado desde `d5e8f54`, ese commit sirvió de oráculo.

Restricción encontrada al leer las pruebas: `catalog-import.e2e-spec.ts` y `graphql.e2e-spec.ts` fijaban la carpeta temporal de archivos sobreescribiendo `CATALOG_IMPORT_OPTIONS`. Si el almacén pasaba a tener su propia configuración sin más, esas pruebas habrían escrito en `.data/catalog-import`, que existe en este equipo con datos que no deben tocarse.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Lo compartido va en un módulo que exporta su servicio (D6.1) | RC3 (`PrinterModule` exporta `PrinterService`; los consumidores importan el módulo) | `ArtifactsModule` provee y exporta `ArtifactStore`; `CatalogImportModule` lo importa. |
| Claves internas por carpeta, nunca rutas del cliente (D6.2) | RC1 (el servidor elige la carpeta), F3 | `artifacts/` solo `<uuid>.csv`, `exports/` solo `<uuid>.tsv`, `tmp/` ambos (`KEY_PATTERNS`). |
| Archivo completo y verificado antes de referenciarlo (D6.3) | F2 inv. 5, C10 (la transacción no incluye el disco) | `writeExport`: `wx` + `sync` en `tmp/`, enlace exclusivo en `exports/`, `sync` del directorio, relectura con tamaño y SHA-256. |
| Una limpieza por feature con la misma lógica (D6.5) | Patrón existente de `ArtifactCleanupService` | `removeOrphans(source, now)`; `ArtifactCleanupService` lo usa con `listArtifacts`, `findReferencedArtifactKeys` y `removeArtifact`. |
| Pruebas que escriben en disco limpian y no tocan datos reales | RC6 (l. 31–39) | Configuración propia del almacén en las E2E y red de seguridad en `isolated-env.ts`. |

### Ajustes al escribir el código

- **Configuración propia del almacén.** `ARTIFACT_STORE_OPTIONS` (`{ root }`) en `artifacts.types.ts`. `root` sale de `CatalogImportOptions`, que conserva `autoStart`, `pollMs` y `shutdownMs`. La raíz sigue saliendo de `CATALOG_IMPORT_ROOT` o `.data/catalog-import`, para no mover archivos guardados.
- **Red de seguridad en las pruebas.** [isolated-env.ts](../../../test/features/support/isolated-env.ts) fija `CATALOG_IMPORT_ROOT` en una carpeta del sistema temporal. Si una prueba monta `ArtifactsModule` sin sobrescribir la configuración, no escribe en `.data/`. Tras la suite completa esa carpeta no existe: ninguna prueba la necesitó.
- **`receive` sigue dependiendo de `catalog-import`.** La subida usa `IMPORT_LIMITS` e `ImportFailure`, y las pruebas esperan ese error. Es el único tipo de subida, así que se deja un comentario en el import en lugar de cambiar el contrato. Si aparece otro tipo de subida, habrá que pasar el límite y el error como parámetros.
- **`ORPHAN_MIN_AGE_MS` se reexporta** desde `artifact-cleanup.service.ts`, porque la prueba de la limpieza lo importa de ahí.
- **Diferencia intencionada con el oráculo:** `removeTemporary` acepta ahora claves `.tsv` (antes lanzaba «Clave de artefacto inválida.»), porque `tmp/` recibe también los TSV. Es la única diferencia que mostró la comparación.
- **Las operaciones de lectura del TSV** (`openExport`) quedan para E6, junto a la descarga. La limpieza de `exports/` también, porque necesita la tabla de E5.

## Implementación y funcionamiento

| Decisión | Archivo y símbolo | Detalle |
| --- | --- | --- |
| D6.1 | [artifacts.module.ts](../../../src/artifacts/artifacts.module.ts), [artifacts.types.ts](../../../src/artifacts/artifacts.types.ts) | Módulo, token y fábrica de la raíz. |
| D6.2 | [artifact.store.ts](../../../src/artifacts/artifact.store.ts), `KEY_PATTERNS`, `isValidKey`, `pathOf` | Validación de la clave según la carpeta. |
| D6.3 | mismo archivo, `writeExport` → `writeTemporary`, `moveToExports`, `verifyExport` | Orquesta los tres pasos. Si el enlace falla, borra el temporal. Si la verificación no coincide, borra el TSV y falla. Si releer falla, el archivo queda sin referencia y lo retira la limpieza. |
| Sin cambio | mismo archivo, `finalize` → `linkInto('artifacts', …)`; `listArtifacts` → `list('artifacts')` | Mismos pasos que antes (enlace exclusivo, `sync` del directorio, borrar temporal, deshacer si falla). |
| D6.5 | [remove-orphans.ts](../../../src/artifacts/remove-orphans.ts), `removeOrphans`; [artifact-cleanup.service.ts](../../../src/catalog-import/artifact-cleanup.service.ts) | Misma secuencia de llamadas que el código anterior. |
| Cableado | [catalog-import.module.ts](../../../src/catalog-import/catalog-import.module.ts), [import.types.ts](../../../src/catalog-import/import.types.ts) y los imports de servicio, worker, interceptor y limpieza | Importa `ArtifactsModule`; sin proveedor propio del almacén. |

Cambio de líneas, solo como dato: `artifact.store.ts` pasa de 158 a 276 líneas (carpeta `exports/` y escritura verificada); el módulo, los tipos y `remove-orphans.ts` suman 75; `src/catalog-import/` pierde 167 líneas netas, casi todas por el archivo movido.

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| Suite completa tras solo mover el almacén (antes de añadir `exports/`) | 27 suites y 519 pruebas en verde. |
| Comparación diferencial con `preparar_comparacion.py` (oráculo `d5e8f54`, compilando cada copia con `tsc`) y [un comparador propio](#comparador) de 39 pasos: `receive`, `finalize`, colisión, límite de tamaño, cancelación, claves inválidas en cada operación, `listArtifacts`, limpieza con archivos antiguos, recientes, referenciados y ajenos, y arranque sin `autoStart` | Tras solo mover: `equal: true` (0 diferencias), una vez normalizados la carpeta temporal y los UUID de los mensajes. Tras añadir `exports/` y `removeOrphans`: una sola diferencia, la intencionada (`removeTemporary` de una clave `.tsv`). |
| Control de la comparación: cambiar en la copia nueva compilada el patrón de clave para aceptar `.tsv` | Aparecen diferencias (296 líneas de `diff` y un fallo de lectura); al restaurarlo vuelven a 0. |
| [artifact-store-exports.spec.ts](../../../test/features/artifacts/artifact-store-exports.spec.ts) | 12 pruebas: permisos de `exports/` (0700) y del archivo (0600); clave, tamaño y SHA-256; `tmp/` vacío; claves nuevas en cada escritura; enlace denegado (`EACCES`) borra el temporal; verificación que no coincide borra el TSV; `listExports` ignora CSV y otros nombres; `removeExport` idempotente; aislamiento de claves entre carpetas. |
| [remove-orphans.spec.ts](../../../test/features/artifacts/remove-orphans.spec.ts) | 4 pruebas: orden de llamadas, margen exacto, consulta aunque no haya antiguos, error al borrar se propaga sin seguir. |
| Pruebas existentes de `catalog-import` y GraphQL | Solo cambian imports y configuración (20 líneas en 7 archivos); ninguna línea de aserción cambia (`git diff` filtrado por `expect`, `toBe`, `toEqual`, `rejects`…). |
| Cobertura de `src/artifacts/` con las suites de artefactos y `catalog-import` | `artifact.store.ts` 96 % de líneas y 92 % de ramas; `remove-orphans.ts` 100 %. Sin cubrir: la carrera entre `readdir` y `stat`, el fallo del `sync` del directorio tras enlazar (las dos ya estaban sin cubrir antes) y el fallo de escritura en `tmp/` de `writeTemporary` (nuevo). |
| Defectos introducidos a propósito, uno por uno, y restaurados con copia + `diff` | Sin verificar → 1 fallo. No borrar si no coincide → 1. No borrar el temporal si el enlace falla → 1. `artifacts/` acepta TSV → 2. Margen de huérfanos estricto (`>`) → 3. Sin carpeta `exports/` al iniciar → 9. La limpieza de importaciones borra en `exports/` → 1. |
| Arranque real de `AppModule` (script en el directorio temporal de la sesión) con PGlite, Descope simulado, `autoStart: false` y raíz temporal | `GET /api/v1/projects`, `…/imports` y `…/evaluations/:id` → `401` sin sesión; la raíz contiene `artifacts`, `exports` y `tmp`. `.data/catalog-import` conserva sus fechas del 26 de octubre. |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | Sin errores. |
| `pnpm lint` (`oxlint --type-aware src/`) | Sin avisos, salida 0. |
| `./node_modules/.bin/prettier --check src test/features` | Todo con el estilo de Prettier. |
| `pnpm test:features` | 29 suites y 535 pruebas en verde (519 previas + 16 nuevas). |
| `pnpm db:verify` | 3 de 3 (pruebas locales, sin conectar a Neon). |

<a id="comparador"></a>El comparador y el script de arranque vivieron en el directorio temporal de la sesión; las copias de la comparación se borraron al terminar. La comparación cubre los casos escritos: no es una prueba formal de equivalencia.

**Incidencias:** `noclobber` impidió dos veces sobrescribir con `>` (trampa 1 del traspaso): una al reescribir `isolated-env.ts`, que se repitió con la herramienta de escritura, y otra con la salida del comparador, que se repitió con `>|`. La primera ejecución de las pruebas de `catalog-import` pasó sin la red de seguridad; la suite completa final ya la incluye.

**No verificado:**

- Escritura y verificación en el disco de producción: las pruebas usan el sistema temporal de macOS.
- El fallo de escritura en `tmp/` (`writeTemporary`) no se provoca en ninguna prueba.
- La valoración de legibilidad de la reorganización corresponde al usuario.

## Consecuencias y continuidad

- `ArtifactStore` ya puede guardar TSV verificados, y la lógica de huérfanos sirve para cualquier carpeta.
- E5 creará la tabla `exports`, el POST y el uso de `writeExport` dentro del flujo de D7. Su E2E debe sobrescribir `ARTIFACT_STORE_OPTIONS`.
- E6 añadirá la lectura del TSV con apertura previa, la limpieza de `exports/` y la retirada de archivos en los borrados.
- Cambios de esta etapa, sin commit: `src/artifacts/` (nuevo, con `artifact.store.ts` movido desde `src/catalog-import/`), `src/catalog-import/` (módulo, tipos, limpieza e imports), las dos pruebas nuevas en `test/features/artifacts/`, siete pruebas de `catalog-import` y GraphQL (imports y configuración) e `isolated-env.ts`.
