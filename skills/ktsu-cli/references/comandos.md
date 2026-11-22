# Referencia de comandos

Todos los comandos se ejecutan desde `scripts/ktsu-cli` como `pnpm run ktsu <comando>`. Con Node 24+ y sin pnpm, `node bin/ktsu.mjs <comando>` es equivalente. pnpm escribe su propia línea `$ node ./bin/ktsu.mjs …` en stderr, así que stdout queda limpio para `--json`.

## Opciones comunes

| Opción | Uso |
| --- | --- |
| `--json` | Imprime JSON compacto en stdout. Los errores salen en stderr como `{"code", "message", "requestId"?, "callId"?}`. |
| `--api-url <URL>` | Sustituye el destino guardado solo en esta llamada. HTTPS, o HTTP en `localhost`/`127.0.0.1`/`[::1]`. Ruta `/` o `/api/v1`. |
| `--web-url <URL>` | Origen de la web para construir enlaces (por ejemplo, `feed delivery`). |
| `--project-id <uuid>` | Proyecto para OAuth. Con una credencial de proyecto, el proyecto lo fija la credencial. |
| `--token-stdin` | Lee la credencial CLI desde un pipe. Rechaza una terminal interactiva. |
| `-h`, `--help` | Muestra la lista de comandos. |

El orden de prioridad es: opción → variable de entorno → perfil guardado. El perfil solo aporta `webUrl` y `projectId` cuando la API elegida coincide con la guardada.

| Variable | Uso |
| --- | --- |
| `KTSU_API_URL`, `KTSU_WEB_URL`, `KTSU_PROJECT_ID` | Destino sin tocar el perfil. |
| `KTSU_TOKEN` | Credencial CLI de proyecto. Si existe, la CLI no usa OAuth. |
| `KTSU_CONFIG_PATH` | Perfil alternativo. Por defecto `$XDG_CONFIG_HOME/ktsu/config.json` o `~/.config/ktsu/config.json`. |

## Perfil

| Comando | Resultado |
| --- | --- |
| `config set --api-url <URL> [--web-url <URL>] [--project-id <uuid>]` | Guarda el perfil con permisos `0600`. Si cambia la API, descarta la web y el proyecto anteriores salvo que los indiques. Devuelve el perfil guardado. |
| `config show` | Devuelve `{ apiUrl?, webUrl?, projectId? }`. Nunca contiene secretos. |

## Acceso

| Comando | Resultado |
| --- | --- |
| `auth login [--read-only]` | Abre Descope en el navegador del mismo equipo con PKCE y callback en `127.0.0.1`. Guarda la sesión en el llavero. Necesita la concesión **Integraciones → CLI → Autorizar CLI con OAuth**. |
| `auth status` | Devuelve la sesión: audiencia, organización, proyecto, capacidades y vencimiento. Es la primera comprobación de cualquier recorrido. |
| `auth logout` | Borra la sesión local e intenta revocar los tokens en Descope. |

## Operaciones

| Comando | Resultado |
| --- | --- |
| `operations list` | Operaciones que la credencial puede usar, con nombre, descripción, modo y esquema. |
| `operations describe <nombre>` | Esquema de una operación. Es la fuente de los campos y selectores de `--input`. |
| `read <nombre> [--input <archivo.json>]` | Ejecuta una lectura (`mode: execute`). |
| `prepare <nombre> [--input <archivo.json>] [--call-id <uuid>]` | Aplica el cambio en la misma llamada (`mode: prepare`). Devuelve `proposalId`, `status: confirmed`, `summary`, `result` y el `callId` usado. |

`--input` acepta un archivo con un objeto JSON de hasta 32 KiB. Para reintentar un `prepare` cuya respuesta se perdió, repite el mismo `--call-id`, la misma operación y los mismos argumentos.

## Estado de un cambio y archivos

| Comando | Resultado |
| --- | --- |
| `proposals status <proposalId>` | Estado `ready`, `confirming`, `confirmed`, `failed`, `rejected` o `expired`, con el resultado o el motivo del fallo. |
| `proposals download <proposalId> --output <archivo>` | Descarga el archivo de una exportación de hoja confirmada. |
| `exports download <exportId> --output <archivo.tsv>` | Descarga una exportación aprobada. |
| `feed download <versionId> --feed-id <uuid> --output <archivo.tsv>` | Descarga una versión del feed. |
| `feed delivery` | Devuelve `{ url }` de la sección de entrega del feed en la web. |

Las descargas escriben primero en un temporal y nunca reemplazan un archivo existente: elige un nombre nuevo.

## Errores

La CLI termina con código 1 y conserva el `code` público de la API. `KTSU_CLI_ERROR` indica un error local: opción, archivo, perfil o conexión. Informa del `code`, el `message` y el `requestId` si aparece. `INTEGRATION_OAUTH_GRANT_REQUIRED` significa que falta la concesión en Integraciones. 401 indica credencial ausente, vencida o revocada; 403, capacidad insuficiente; 404, operación no expuesta o recurso ajeno; 429, cuota.
