# 07 — Descarga remota con la IP validada (E3)

Fecha de creación: 2026-11-02  
Estado: Fuentes consultadas para la etapa E3; se aplican en la [bitácora 03](../../../../bitacora-construccion/feature/feeds&publications/03-fuente-remota-segura.md). Resuelve el vacío de la ficha 02 («cómo fijar la IP con el cliente HTTP de Node»).  
Tipo de fuente: documentación oficial de Node.js v26 y registros de IANA.  
Fecha de consulta: 2026-11-02 (todas las URL de esta ficha)  
Revisión del proyecto: `f6b4bf9` con los cambios sin commit de E1–E2.  
Relacionada con: [plan 01](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md) (D9), [fuentes técnicas](02-fuentes-tecnicas.md) (F21, F22).

## Necesidad

D9 exige conectar solo a direcciones públicas, sin redirecciones y sin dejar hueco entre validar el nombre y conectarse (*DNS rebinding*, F21). Hay que saber dónde se resuelve el nombre en el cliente HTTP de Node y qué rangos bloquear.

## Fuentes

| ID | Fuente y sección | Qué establece (paráfrasis) | Uso en E3 |
| --- | --- | --- | --- |
| F32 | [Node.js v26: HTTP, `http.request(url[, options][, callback])`](https://nodejs.org/docs/latest-v26.x/api/http.html#httprequesturl-options-callback) | Opciones `lookup` (función de resolución propia; por defecto `dns.lookup()`), `signal` (un `AbortSignal` que aborta la petición), `timeout` (inactividad del socket, también antes de conectar), `maxHeaderSize` (16 KiB por defecto) y `setHost` (añade `Host` automáticamente). La sección no documenta seguir redirecciones. | `https.request(url, { lookup, signal })`: la URL conserva el nombre, así que `Host`, SNI y la validación del certificado usan el nombre, mientras la conexión va a la dirección que devuelve `lookup`. Como no sigue redirecciones, un 3xx se trata como error (no hace falta desactivar nada). |
| F33 | [Node.js v26: Net, `socket.connect(options)`](https://nodejs.org/docs/latest-v26.x/api/net.html#socketconnectoptions-connectlistener) y `net.BlockList` | `lookup` es la resolución que usa la conexión. Con `autoSelectFamily` (activado por defecto) se pasa `all: true` a `lookup` y se intenta conectar a todas las direcciones obtenidas. La página no dice si `lookup` se salta cuando el host es una IP. `BlockList` admite `addSubnet` para IPv4 e IPv6 y `check(dirección, tipo)`; reconoce IPv4 escrita como IPv6 mapeada. | El `lookup` propio resuelve con `dns.lookup(…, { all: true })`, rechaza **todo** el conjunto si alguna dirección no es pública y responde en la forma pedida (lista con `all`, o dirección y familia sin él). Las IP literales en la URL se validan aparte, antes de la petición, porque la documentación no garantiza que pasen por `lookup`. |
| F34 | [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml) | Bloques especiales y si son alcanzables globalmente: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `240.0.0.0/4` y `255.255.255.255/32` no lo son. | Lista de bloqueo IPv4, más multicast `224.0.0.0/4` (F21). Se bloquea `192.0.0.0/24` completo aunque contenga dos direcciones anycast globales: un catálogo nunca estará allí. |
| F35 | [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml) | Bloques especiales IPv6, entre ellos `::/128`, `::1/128`, `::ffff:0:0/96` (IPv4 mapeada), `64:ff9b::/96` y `64:ff9b:1::/48` (traducción), `100::/64`, `2001::/23`, `2001:db8::/32`, `2002::/16` (6to4), `3fff::/20`, `5f00::/16`, `fc00::/7` y `fe80::/10`. | Lista de bloqueo IPv6, más multicast `ff00::/8` (F21). Se bloquean también los prefijos de traducción y túnel (`64:ff9b::/96`, `2001::/23`, `2002::/16`) aunque algunos sean globales, porque pueden llevar a una IPv4 privada. |

## Decisión que cierra el vacío de la ficha 02

**Sin dependencias nuevas:** `https.request` con `lookup` propio. No se usa `fetch`, porque `undici` no se puede importar sin instalarlo como paquete y `fetch` no acepta un `lookup`.

## Límites

- Que `lookup` no se llame con IP literales no está documentado (F33); se cubre validándolas antes de la petición y con una prueba.
- La ruta TLS (SNI y certificado con el nombre) no se puede probar en local sin un certificado; las pruebas usan HTTP contra un servidor local, permitido solo por una opción de pruebas. Que el nombre de la URL se mantiene para TLS se apoya en F32 (la URL no se reescribe), no en una prueba.
- Las listas de IANA cambian con el tiempo; se consultaron el 2026-11-02.
