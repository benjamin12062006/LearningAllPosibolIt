# 07 — Estado del feed y cierre de la feature (E7)

Fecha de creación: 2026-11-04  
Estado: Implementado y verificado en local. Sin migración nueva. Plan cerrado.  
Ámbito: etapa E7 del [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md): última actualización en la vista del feed, historial de versiones, registro de fallos definitivos (D12) y actualización de docs-diagrams 06–09.  
Relacionada con: [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), bitácoras [01](01-feed-y-publicacion-manual.md)–[06](06-programacion-diaria.md), [docs-diagrams/06](../../../../docs-diagrams/06-dominio-y-datos-postgresql.md), [07](../../../../docs-diagrams/07-arquitectura-y-contratos.md), [08](../../../../docs-diagrams/08-secuencias-y-estados.md), [09](../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md).  
Revisión de partida: `f6b4bf9` con los cambios sin commit de E1–E6.

## Necesidad y punto de partida

El usuario pidió seguir con E7. D12 pedía que el operador viera la fecha, los fallos y la versión publicada (docs-diagrams/05, RF06). Tras E6, la versión publicada ya estaba en el `GET` del feed; faltaban la última actualización, el historial y el registro de fallos. Sin investigación externa nueva.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| «Alertas» = estado consultable (D12) | docs-diagrams/05 («mostrar fecha, fallos y versión publicada») | `lastRefresh` en la vista del feed: id, estado, paso, resultado, error público, fecha programada y fechas. Avisos activos (correo, webhook) fuera del plan. |
| Una fila por feed sin agrupar | — | `LEFT JOIN LATERAL (… ORDER BY created_at DESC, id DESC LIMIT 1)` en la consulta del feed. |
| Historial paginado | Patrón de `catalog-import` (`PaginationQueryDto`, `fetchWindow`, `toPage`) | `GET …/feeds/:feedId/versions?limit&offset` → `{ versions, page }`, de la más reciente a la más antigua, con `current` y `fileRetained` (falso si la retención retiró el archivo). Sin la clave del archivo. |
| Fallos definitivos en el registro | RNF05 | `warn` `FEED_REFRESH_FAILED` con `errorCode`, `feedId` y `refreshId`; nunca la URL de la fuente ni datos del catálogo. |

### Ajustes al escribir el código

- **Los tipos de estado de una actualización** (`RefreshStatus`, `RefreshStage`, `RefreshOutcome`) pasan a `feeds.types.ts`, porque el feed los muestra. `feed-refreshes.types.ts` los reexporta, así que la dependencia sigue yendo de `feed-refreshes` hacia `feeds`.
- **`lastPublishedAt` no se añadió**: es `publishedVersion.publishedAt`, que ya estaba.
- **La prueba de «la más reciente» se reforzó con dos actualizaciones.** Con una sola, invertir el orden no se habría detectado.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas | 7: 3 de integración del estado (sin actualizaciones / en cola / terminada y la más reciente; motivo de `needs_review`; registro del fallo sin la URL), 2 de integración del historial y 2 E2E de `GET …/versions`. |
| Pruebas de feeds y actualizaciones | 146 en verde. |
| Suite completa | 993 de 994. La que falla es el conteo de migraciones de `projects.repository.int-spec.ts`: espera 19 y hay 20, porque la sesión de hojas de cálculo creó `20261104090000_create_worksheet_row_versions` sin actualizar el conteo. No es de esta feature y no se tocó. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check` de los archivos de la feature | Sin errores. |
| Esquema frente a migraciones | «This is an empty migration». |
| `pnpm db:verify` | **No se pudo completar**: su `pnpm build` compila todo `src/`, y `src/worksheets/row-query.ts` (de la sesión de hojas) usa códigos de error que todavía no existen (8 errores). Ajeno a esta feature. |
| Arranque real con el worker encendido | `GET …/feeds/:id`, `…/versions`, `PUT …/schedule`, `…/policy` y `POST …/refreshes` responden `401` sin sesión; la URL pública, `404`; sin errores registrados. |
| Defectos a propósito | 6 de 6 detectados, con restauración comprobada. |

Los defectos fueron:

- T1, última actualización = la más antigua;
- T2, historial en orden inverso;
- T3, `current` invertido;
- T4, `fileRetained` invertido;
- T5, sin registro del fallo;
- T6, historial sin comprobar el propietario.

**Incidencia de entorno:** la carpeta temporal de scripts volvió a vaciarse. La primera ejecución de las pruebas nuevas dio «139 passed» con la compilación anterior, porque el registro de compilación no se pudo escribir. Se detectó al ver que la cifra no cambiaba. Se recreó la carpeta, se compiló comprobando el resultado y se repitió: 146.

## docs-diagrams

- **06:**
  - `feeds`, `feed_versions` y `feed_refreshes` reales en el diccionario, en lugar del diseño de «fase B» y del `job` genérico;
  - el diagrama de relaciones (`FEED ||--o{ FEED_REFRESH`, versión ← exportación);
  - la versión con archivo propio;
  - la invariante 5 aplicada al feed;
  - la carpeta `feeds/` y su retención.
- **07:**
  - `FeedsModule`, `FeedRefreshesModule` y `RemoteSourceModule` en el diagrama de dependencias, con su dirección;
  - `JobRepository` y `FeedRepository` con su implementación;
  - `CatalogSource` remoto ya construido;
  - el contrato HTTP completo del incremento;
  - la ruta pública fuera del prefijo.
- **08:**
  - los cuatro resultados de la actualización automática;
  - el lease sin renovación y las condiciones de escritura;
  - las esperas sin gastar intentos;
  - la clave `(feed_id, scheduled_for)`;
  - la restricción de una sola instancia.
- **09:** estado del incremento 5.

Los diagramas Mermaid editados no se renderizaron.

## Consecuencias y continuidad

- **Plan cerrado.** Queda fuera, según el plan:
  - migrar importación y evaluación a leases (y con ello varias instancias);
  - credenciales de la fuente;
  - avisos activos;
  - limitación de peticiones en la URL pública;
  - GraphQL de feeds (aplazado al final del backend).
- **Pendiente del usuario:** comprobar en el piloto que Merchant Center descarga la URL pública programada.
- **Sin commit** desde `f6b4bf9`.
