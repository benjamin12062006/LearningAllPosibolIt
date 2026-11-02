# 06 — Descarga del TSV, borrados y limpieza (E6)

Fecha de creación: 2026-11-02  
Estado: Implementado y verificado en local. Sin migración nueva. El bloqueo de los snapshots en `deleteProject` no se puede demostrar con PGlite (ver «No verificado»).  
Ámbito: etapa E6 del [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md): `GET …/exports/:exportId/productos.tsv` con apertura previa (D9, R2), retirada de los TSV al borrar importaciones y proyectos (D11) y limpieza de huérfanos de `exports/` al arrancar (D6.5).  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md), [bitácora 05](05-exportar.md), [bitácora 04](04-modulo-de-artefactos.md), [fuentes técnicas](../../../docs/fonts/feature/reviews&exports/02-fuentes-tecnicas.md) (F21, F22, F23), [cursos y reconstrucciones](../../../docs/fonts/feature/reviews&exports/03-cursos-y-reconstrucciones.md) (RC1, RC6, C8).  
Revisión de partida: `d5e8f54` con los cambios sin commit de E1–E5.

## Necesidad y punto de partida

El usuario pidió empezar E6. Tras E5: 31 suites y 568 pruebas en verde. La respuesta del `POST` ya daba `downloadUrl`, pero la ruta no existía, y un TSV de una evaluación borrada en cascada quedaba en `exports/` sin referencia.

No hizo falta investigación externa. Las fuentes ya estaban en la ficha 02: F21 para el tipo de medio, F22 para `StreamableFile` y el `400` de Express ante un error del stream, y F23 para la cascada.

Restricciones encontradas al leer el código:

- **Contrato de los borrados.** Las pruebas de `catalog-import` comparan con `toEqual` lo que devuelven `deleteSnapshot` y `deleteProject`. Añadir las claves de los TSV cambia esas aserciones de forma intencionada.
- **Carrera en `deleteProject`.** El borrado bloquea el proyecto, pero una exportación en curso bloquea su evaluación y su snapshot (`FOR SHARE`), no el proyecto. Si las claves de los TSV se leyeran antes de que esa exportación confirme, su archivo se quedaría sin retirar.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Abrir el archivo antes de responder (D9, R2) | F22 «Stream errors»: con Express, un error del stream antes de enviar datos llega como `400` | `ArtifactStore.openExport` hace `open` y devuelve `createReadStream` del descriptor; si falta, el servicio responde `503 EXPORT_FILE_UNAVAILABLE` y registra `EXPORT_FILE_MISSING` con el id, sin datos del catálogo. |
| Descarga con `StreamableFile` y cabeceras explícitas (D9) | F21 (tipo de medio y parámetro de juego de caracteres), F22 (`type`, `disposition`, `length`), C8 | `text/tab-separated-values; charset=utf-8`, `attachment; filename="productos-<id>.tsv"` y `Content-Length` igual a `byte_size`. |
| Retirar los TSV tras el commit del borrado (D11) | F23 (cascada para un componente), patrón existente de `removeDeletedArtifacts` | Cada importación borrada devuelve también `exportArtifactKeys`; el servicio los retira después del CSV y, si falla, registra `EXPORT_ORPHAN_RETAINED` sin deshacer el borrado. |
| Leer las claves con los snapshots bloqueados (D11) | Patrón de `deleteSnapshot` (`FOR UPDATE OF s`) | `deleteProject` bloquea con `FOR UPDATE` los snapshots del proyecto antes de leer las claves. |
| Limpieza de huérfanos de `exports/` (D6.5) | `removeOrphans` de E4 | `ExportCleanupService` al arrancar, con `EXPORT_OPTIONS.autoStart` (por defecto `true`) y la consulta `findReferencedArtifactKeys` sobre `exports`. |

### Ajustes al escribir el código

- **Campo nuevo en `DeletedImport`.** `exportArtifactKeys: string[]` en cada importación borrada. Cuatro sitios de las pruebas existentes de `catalog-import` lo añaden con `[]`: los dos dobles de `catalog-import.service.spec.ts` y las dos aserciones `toEqual` de `catalog-import.repository.int-spec.ts`. Es el cambio de contrato buscado.
- **`removeArtifactOrLog` recibe solo lo que usa** (`snapshotId` y `artifactKey`), porque también lo llama la recuperación de una aceptación fallida, que no tiene TSV.
- **`isMissingFile` se exporta** desde `artifact.store.ts`, para que el servicio distinga el archivo ausente sin repetir la comprobación de `ENOENT`.
- **Opción de arranque propia.** `EXPORT_OPTIONS` (`autoStart`). La integración la desactiva para probar la limpieza llamándola directamente.
- **Lectura de tablas ajenas, con comentario.** `catalog-import` lee la tabla `exports` (`findExportKeys`) y llama a `store.removeExport`. Los comentarios indican que la tabla y los archivos son del módulo `exports`, pero la operación vive aquí porque el borrado es de este módulo, como ya pasaba con la comprobación de evaluaciones activas.

## Implementación y funcionamiento

| Decisión | Archivo y símbolo | Detalle |
| --- | --- | --- |
| R2 | [artifact.store.ts](../../../src/artifacts/artifact.store.ts), `openExport`, `isMissingFile` | Abre con `open(…, 'r')`; el descriptor se cierra al terminar o cancelar la lectura. |
| D9 | [exports.repository.ts](../../../src/exports/exports.repository.ts), `findFileByOwner`; [exports.service.ts](../../../src/exports/exports.service.ts), `openDownload`, `openFile`; [exports.controller.ts](../../../src/exports/exports.controller.ts), `download`, `PRODUCTS_TSV_TYPE` | Propietario y proyecto → fila → archivo abierto → `StreamableFile`. |
| D10 | [error-codes.ts](../../../src/common/http/error-codes.ts), [messages.ts](../../../src/common/http/messages.ts) | `EXPORT_FILE_UNAVAILABLE` (503). |
| D11 | [catalog-import.repository.ts](../../../src/catalog-import/catalog-import.repository.ts), `deleteSnapshot`, `deleteProject`, `findExportKeys`; [import.types.ts](../../../src/catalog-import/import.types.ts), `DeletedImport` | Las claves se leen dentro de la transacción, con los snapshots bloqueados, antes del `DELETE` en cascada. |
| D11 | [catalog-import.service.ts](../../../src/catalog-import/catalog-import.service.ts), `removeDeletedArtifacts`, `removeExportOrLog` | CSV y después sus TSV, cada uno con su propio `try/catch` y registro. |
| D6.5 | [export-cleanup.service.ts](../../../src/exports/export-cleanup.service.ts), `ExportCleanupService`; [exports.types.ts](../../../src/exports/exports.types.ts), `EXPORT_OPTIONS`; [exports.module.ts](../../../src/exports/exports.module.ts) | Misma forma que `ArtifactCleanupService`. |

## Comprobación

| Comando o prueba ejecutada | Resultado observado |
| --- | --- |
| [exports.e2e-spec.ts](../../../test/features/exports/exports.e2e-spec.ts), 6 pruebas nuevas | Descarga con `Content-Type`, `Content-Disposition` y `Content-Length` exactos; bytes iguales al archivo guardado y SHA-256 igual a `tsvChecksum` (`responseType('blob')`, trampa 7). Bob → `404` en el proyecto de Alice y desde el suyo. Archivo borrado → `503` y registro `EXPORT_FILE_MISSING` con el id. Exportación inexistente `404`, id no UUID `400`, sin sesión `401`. Borrar la importación por HTTP → exportación `404` y `exports/` vacía. Borrar el proyecto con dos exportaciones → `exports/` vacía. |
| [exports.int-spec.ts](../../../test/features/exports/exports.int-spec.ts), 5 pruebas nuevas | `deleteSnapshot` devuelve la clave del TSV. `deleteProject` devuelve las claves agrupadas por importación, que coinciden con los archivos. La limpieza borra solo el huérfano antiguo (no el referenciado ni el reciente). Con `autoStart: false` no limpia al arrancar. Un fallo se registra (`EXPORT_ORPHAN_CLEANUP_FAILED`) y no impide arrancar. |
| [artifact-store-exports.spec.ts](../../../test/features/artifacts/artifact-store-exports.spec.ts), 3 pruebas nuevas | `openExport` devuelve el contenido; si falta, falla al abrir con `ENOENT`; rechaza claves de otra carpeta y rutas que salen de `exports/`. |
| [catalog-import.service.spec.ts](../../../test/features/catalog-import/catalog-import.service.spec.ts), 2 pruebas nuevas | Orden `commit → CSV → sus TSV → siguiente CSV`. Un fallo al retirar un TSV registra `EXPORT_ORPHAN_RETAINED` y sigue con el siguiente. |
| Defectos introducidos a propósito, uno por uno, con el script de Python de E5 (copia en memoria, un cambio, pruebas de `exports`, `artifact-store` y `catalog-import`, restauración comprobada byte a byte) | Abrir el TSV de forma perezosa → 2 fallos. No traducir el archivo ausente a `503` → 1. Tipo `text/plain` → 1. Sin `length` → 1. `deleteSnapshot` sin claves → 2. El servicio no retira los TSV → 4. La limpieza lista `artifacts/` → 1. Las referencias se buscan en `catalog_snapshots` → 1. **`deleteProject` sin `FOR UPDATE` de los snapshots → 0 fallos**, como se esperaba (ver «No verificado»). Antes y después: 203 de 203 en verde. |
| Comprobación esquema-migraciones (script de E5) | «This is an empty migration». |
| Arranque real de `AppModule` (PGlite, Descope simulado, trabajos detenidos, raíz temporal; la limpieza de `exports/` sí se ejecuta) | `GET …/productos.tsv` → `401` sin sesión, igual que el resto; carpetas `artifacts`, `exports` y `tmp`; sin errores de arranque. `.data/catalog-import` sin cambios. |
| Cobertura de `src/exports/` con las suites de exportaciones, artefactos y `catalog-import` | 98,8 % de líneas y 95,7 % de ramas. Sin cubrir: el registro cuando la limpieza al arrancar borra algo, `openFile` ante un error distinto de `ENOENT`, el `catch` de `discardFile` y el error de `requireExisting`. |
| `./node_modules/.bin/tsc -p tsconfig.json --noEmit` | Sin errores. |
| `pnpm lint` (`oxlint --type-aware src/`) | Sin avisos, salida 0. |
| `./node_modules/.bin/prettier --check src test/features` | Todo con el estilo de Prettier. |
| `pnpm test:features` | 31 suites y 585 pruebas en verde: 568 previas, 16 nuevas y 1 de `messages.spec.ts` por el código nuevo. |
| `pnpm db:verify` | 3 de 3. |

**No verificado:**

- **El bloqueo `FOR UPDATE` de los snapshots en `deleteProject`.** Quitarlo no hace fallar ninguna prueba, porque PGlite ejecuta las transacciones una tras otra (trampa 4 del traspaso) y nunca hay una exportación a medias mientras se borra. Lo respaldan el razonamiento del comentario y el mismo patrón en `deleteSnapshot`. Si el bloqueo fallara en producción, el TSV quedaría huérfano y lo retiraría la limpieza al arrancar: no se expone a nadie, porque la descarga exige la fila.
- **Descarga de archivos grandes y cancelación a mitad.** La medición de E1 da 1,5 MB para 5.000 productos; no se probó cortar la conexión durante la descarga.
- **Comprobación en Merchant Center** (D14) y aplicación de la migración de E5 en Neon: pendientes del usuario.

## Consecuencias y continuidad

- El recorrido de la fase A está completo en la API: revisar, aprobar, exportar, descargar y borrar sin dejar archivos.
- Queda E7: actualizar `docs-diagrams/06` y `07` (tabla `exports` y contrato de exportación) y cerrar el plan.
- Cambios de esta etapa, sin commit:
  - **`src/exports/`:** descarga, limpieza, opciones y código `503`;
  - **`src/artifacts/artifact.store.ts`:** `openExport` e `isMissingFile` exportado;
  - **`src/catalog-import/`:** tipos, repositorio y servicio de los borrados;
  - **pruebas nuevas:** en `test/features/exports/`, `test/features/artifacts/` y `catalog-import.service.spec.ts`;
  - **pruebas existentes actualizadas:** los cuatro sitios de `catalog-import` que añaden `exportArtifactKeys: []`.
