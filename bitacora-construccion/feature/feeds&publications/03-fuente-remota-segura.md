# 03 — Fuente remota segura (E3)

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-02 (etapa cerrada)  
Estado: Implementado y verificado en local. Migración `20261102000200_add_feed_source` creada y probada con PGlite; **sin aplicar en Neon**. El servicio de descarga todavía no lo usa nadie: lo conecta E4 al worker.  
Ámbito: etapa E3 del [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md): `src/remote-source/` con las comprobaciones de D9, columnas de fuente en `feeds` y `PUT …/feeds/:feedId/source`.  
Relacionada con: [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md) (D9 y «Contrato de la descarga para E4»), [bitácora 02](02-url-publica-cache-y-retencion.md), [fuentes de E3](../../../docs/fonts/feature/feeds&publications/07-descarga-remota-con-ip-validada.md), [fuentes técnicas](../../../docs/fonts/feature/feeds&publications/02-fuentes-tecnicas.md) (F21, F22), [cursos y reconstrucciones](../../../docs/fonts/feature/feeds&publications/03-cursos-y-reconstrucciones.md) (C5).  
Revisión de partida: `f6b4bf9` con los cambios sin commit de E1–E2. Línea base: 36 suites y 665 pruebas en verde.

## Necesidad y punto de partida

El usuario pidió empezar E3. A mitad de la etapa planteó llevar E4 en otra sesión y pidió dejar documentado el contrato de la descarga. Poco después lo anuló y pidió seguir aquí con normalidad. El contrato quedó en el plan («Contrato de la descarga para E4») y el código lo cumple.

La otra sesión llegó a crear, en esta misma carpeta, `src/jobs/refresh-retry.ts`, su prueba (55 casos) y notas en `docs/plans/feature/feed-refresh/`, `docs/fonts/feature/feed-refresh/` y `bitacora-construccion/feature/feed-refresh/`. **No se han tocado.** Sus pruebas se ejecutan con la suite completa y pasan.

Investigación de la etapa: [ficha 07](../../../docs/fonts/feature/feeds&publications/07-descarga-remota-con-ip-validada.md). Cierra el vacío de la ficha 02 sobre cómo fijar la IP en Node.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Validar la IP en la misma resolución que usa la conexión | F21, F32, F33 | `https.request(url, { lookup })`. El `lookup` propio resuelve con `all: true` y rechaza el conjunto si alguna dirección no es pública. La URL conserva el nombre para `Host`, SNI y certificado. |
| IP literales validadas aparte | F33 (la documentación no garantiza que pasen por `lookup`) | `literalAddressOf` antes de pedir. La prueba con `127.0.0.1`, `[::1]` y `2130706433` lo confirma: sin esta comprobación se conecta (defecto P4). |
| Rangos bloqueados | F34, F35, F21 | Bloques no alcanzables globalmente de IANA más multicast; también los prefijos de traducción y túnel IPv6. |
| Sin redirecciones | F21, F32 | `http.request` no las sigue; un 3xx es `SOURCE_REDIRECT_NOT_ALLOWED` y el destino nunca recibe la petición. |
| Tiempo y tamaño limitados | F22, C5, `IMPORT_LIMITS` | `AbortSignal.timeout(30 s)` combinado con la señal de apagado; `Content-Length` > 10 MiB rechazado sin leer el cuerpo; sin longitud declarada, `ArtifactStore.receive` corta al pasar el límite. |
| Una conexión nueva por descarga | — (precaución propia) | `agent: false`: ningún socket de un pool se reutiliza sin pasar por `lookup`. |
| Sin dependencias nuevas | Ficha 07 | Ni `undici` ni `fetch`, que no aceptan `lookup`. |
| La fuente, con las reglas de la importación | D9 | `UpdateFeedSourceDto extends ImportCatalogDto` más `url` con un validador que usa la misma `parseSourceUrl` que la descarga. |

### Ajustes al escribir el código

- **`net.BlockList` aplica una regla IPv6 a las IPv4.** Con una sola lista, la regla `::ffff:0:0/96` (IPv4 mapeada) hacía que **todas** las IPv4, también `8.8.8.8`, salieran como no públicas. La documentación (F33) solo muestra el sentido contrario. Lo detectó la prueba unitaria; se usa una lista por familia. El defecto P1 lo reproduce.
- **Al apagar se propaga el motivo de la señal** (`AbortError`) y no el error que llega, que puede ser un `ECONNRESET` del socket cortado. Así lo exige el contrato con E4.
- **La base no exige `https:`** en `source_url`, solo longitudes y valores. La API ya lo comprueba al guardar y al descargar; con el `CHECK`, las pruebas de E4 no podrían usar un servidor local `http:`.
- **`RemoteSourceModule` no se importa todavía en `AppModule`:** nadie lo usa hasta E4. El arranque real lo compila aparte para comprobar sus dependencias.

## Implementación y funcionamiento

- [src/remote-source/](../../../src/remote-source/):
  - `public-address.ts` y `source-url.ts`, funciones puras;
  - `remote-source.service.ts`: `download(url, signal?)` → `DownloadedSource`, o `RemoteSourceFailure` con `upstreamStatus`;
  - `remote-source.types.ts` y `remote-source.module.ts`, este con opciones fijas en producción: `https:` solamente y destinos públicos.
- [migration.sql](../../../prisma/migrations/20261102000200_add_feed_source/migration.sql) y columnas `sourceUrl`, `sourceIdColumn` y `sourceDelimiter` en `Feed`.
- [src/feeds/](../../../src/feeds/): `UpdateFeedSourceDto`, `FeedsService.setSource`, `FeedsRepository.setSource`, `PUT …/feeds/:feedId/source` y `source` en la vista del feed.
- Códigos `SOURCE_URL_NOT_ALLOWED`, `SOURCE_REDIRECT_NOT_ALLOWED`, `SOURCE_HTTP_ERROR`, `SOURCE_UNREACHABLE`, `SOURCE_TIMEOUT` y `SOURCE_TOO_LARGE`, con textos es/en.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas nuevas de E3 | 73: 34 de direcciones, 6 de URL, 18 de descarga contra un servidor HTTP local, 3 de integración y 6 E2E de la fuente del feed, y 6 generadas por los códigos nuevos. |
| Suite completa | 40 suites y 793 pruebas en verde: 738 de esta feature y las anteriores (antes 665) y 55 de `refresh-retry.spec.ts`, de la otra sesión. Dos expectativas de E1 y E2 añadieron `source: null` a la vista del feed. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check src test/features` | Sin errores. |
| Esquema frente a migraciones; `pnpm db:verify` | «This is an empty migration»; 3/3. |
| Arranque real | `PUT …/source` → `401` sin sesión. `RemoteSourceModule` con sus opciones de producción rechaza `http://example.com/…` y `https://localhost/…` con `SOURCE_URL_NOT_ALLOWED` sin conectar. |
| Defectos a propósito | P1–P11 se ejecutaron en una copia aparte del proyecto, que después se borró a petición del usuario; P12–P14, en la carpeta original. Resultado en la sección siguiente. |

## Defectos a propósito

12 de 14 detectados. Restauración comprobada con sumas de todos los archivos de `src`, `prisma` y `test/features`. La única diferencia al terminar fueron tres archivos nuevos de `test/features/organizations/`, creados por otra sesión durante la ejecución y ajenos a E3.

| Defecto | Resultado |
| --- | --- |
| P1 una sola lista de bloqueo para las dos familias | Detectado |
| P2 sin el bloque `10.0.0.0/8` | Detectado |
| P3 basta con que una dirección resuelta sea pública | **Sobrevive**: no se puede provocar en local un nombre con direcciones públicas y privadas |
| P4 las IP literales no se validan | Detectado (sin la comprobación se llega a conectar) |
| P5 una redirección se trata como error HTTP | Detectado |
| P6 sin comprobar `Content-Length` | Detectado |
| P7 el tiempo agotado no se reconoce | Detectado |
| P8 al apagar se propaga el error del socket | Detectado |
| P9 `http:` admitido siempre | Detectado |
| P10 credenciales admitidas en la URL | Detectado |
| P11 el DTO no valida la URL | Detectado |
| P12 sin `CHECK` de fuente completa | Detectado al repetirlo. La primera versión del defecto estaba mal escrita (renombraba la restricción y dejaba su condición). Un intento intermedio coincidió con una edición a medias de la sesión de organizaciones (32 pruebas cargadas, «no compila» al final); se repitió con el árbol estable: 1 fallo de 141 y migración restaurada idéntica. |
| P13 `setSource` no filtra por proyecto ni propietario | Detectado |
| P14 sin `agent: false` | **Sobrevive**: la reutilización de sockets no se observa con un único servidor local |

## Consecuencias y continuidad

- La ruta TLS (SNI y certificado con el nombre) no se prueba en local: se apoya en que la URL no se reescribe (F32).
- Que el `lookup` rechace un conjunto mixto (una dirección pública y otra privada) no se puede provocar en local sin un DNS propio. El defecto P3 (`some` en lugar de `every`) sobrevive por eso.
- **Pendiente del usuario:** aplicar en Neon las migraciones de E1 y E3.
- **Siguiente:** E4. Partirá de `src/jobs/refresh-retry.ts` (de la otra sesión), revisándolo antes de usarlo.
