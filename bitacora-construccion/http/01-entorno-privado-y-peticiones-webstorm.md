# 01 — Entorno privado y peticiones compatibles con WebStorm

Fecha de creación: 2026-10-26
Estado: Implementado y verificado
Ámbito: Colección HTTP y generador local de sesión de prueba
Relacionada con: [Fuentes oficiales](../../docs/fonts/http/01-http-client-webstorm-y-httpyac.md), [guía de peticiones](../../docs/autenticacion-descope/request.md), [autenticación inicial](../auth/01-validar-sesion-descope.md)
Revisión de partida: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales previos preservados.

## Necesidad y punto de partida

`auth.http` ya contenía el cambio manual del usuario a `{{TEST_SESSION_JWT}}`.
Las otras tres colecciones usaban `$dotenv`; `saveSessionJwt` generaba
`requests/.env`. Ya existía un JSON privado local con el entorno `local`.
El incremento cambia únicamente las herramientas de petición y su documentación.

## Evidencia, interpretación y decisión

La [ficha de fuentes](../../docs/fonts/http/01-http-client-webstorm-y-httpyac.md)
registra F1–F4 y sus apartados oficiales. La cadena aplicada es:

| Necesidad | Evidencia | Interpretación y adaptación |
| --- | --- | --- |
| Resolver el JWT en WebStorm | F1: variables y JSON privados | `{{TEST_SESSION_JWT}}`, entorno `local`, secreto junto a los `.http` |
| Conservar CLI existente | F4: entornos IntelliJ y CLI | Seleccionar `--env local` también desde pnpm y el script |
| Evitar copiar IDs manualmente | F3: handlers y variables globales | Capturar IDs de respuestas satisfactorias |
| Mantener sintaxis vigente | F2: nombres y multipart | Nombrar las peticiones y conservar el CSV multipart existente |

Se descarta introducir un cliente nuevo: httpYac ya soporta este subconjunto.
Se conserva `client.global` en vez del nuevo `client.variables` para compartir los
archivos con la versión instalada. No se modifica autenticación, rutas ni DTOs.

## Implementación y funcionamiento

| Archivo y símbolo | Cambio aplicado |
| --- | --- |
| [run-auth-request.mts](../../scripts/descope/run-auth-request.mts), `saveSessionJwt` | Lee o crea el JSON privado, actualiza `local.TEST_SESSION_JWT`, conserva el resto y aplica permisos `0600`. Rechaza JSON o entorno local inválidos sin sobrescribir contenido. No imprime errores de `JSON.parse` que pudieran revelar el secreto. |
| Mismo script, `runAuthenticationTest` | Ejecuta la petición `authenticated` con `--env local`; el JWT se resuelve desde el JSON, sin inyectarlo en `process.env`. Conserva el procedimiento existente de usuarios de prueba y el inicio/parada de Nest. |
| [http-client.env.json](../../requests/http-client.env.json) | Comparte únicamente `local.apiUrl`; el archivo privado queda junto a las peticiones. |
| [auth.http](../../requests/auth.http) y [users.http](../../requests/users.http) | Usan `{{TEST_SESSION_JWT}}`; el handler autenticado comprueba exactamente HTTP `200`. Se conserva la sintaxis probada por el usuario. |
| [projects.http](../../requests/projects.http), `createProject` | Captura `projectId` de la respuesta HTTP `201` y nombra las cinco peticiones. |
| [catalog-import.http](../../requests/catalog-import.http), `acceptCatalogImport` | Conserva el multipart y captura `jobId` y `snapshotId` únicamente tras HTTP `202`. Las consultas posteriores usan esos IDs. |
| [package.json](../../package.json), `api:request`; [.gitignore](../../.gitignore) | Selección CLI de `local` y exclusión explícita del JSON privado en cualquier carpeta. |
| [Guía HTTP](../../docs/autenticacion-descope/request.md), [prueba auth](../../docs/autenticacion-descope/01-prueba-auth-end-to-end.md) y [README](../../README.md) | Documentan ubicación, entorno, nombres, orden de uso y duración de los IDs capturados. |

Se confirmó que ya había un JWT en el JSON privado antes de retirar únicamente
`TEST_SESSION_JWT` de los dos dotenv locales. El `requests/.env` generado quedó sin
configuración y se retiró; `.env` conserva las credenciales del backend.
Después, la prueba real renovó el token directamente en el JSON privado.

La captura de IDs usa memoria del cliente, no modifica el JSON privado. Para
comandos separados o recursos existentes pueden definirse esos IDs en el entorno
privado. En WebStorm tienen prioridad sobre los globales; deben retirarse si se
quiere volver a la captura automática. No hay marcadores públicos que la oculten.

## Comprobación

| Comando o comprobación ejecutada | Resultado observado |
| --- | --- |
| `pnpm api:auth-test` | Prueba real satisfactoria: API existente devuelve `401` sin sesión, reutilización del test user, fallback Magic Link, validación de sesión, guardado en JSON privado y petición autenticada HTTP `200`. Código de salida `0`. |
| `saveSessionJwt` aislada desde el código real, con archivos temporales y tokens ficticios | Creación, renovación, conservación de otras claves y entornos, permisos `0600`, rechazo de JSON inválido, raíz array y entorno local array sin sobrescribir contenido: correctos. |
| Harness temporal con CLI httpYac y servidor HTTP ficticio | Se inventariaron las 14 peticiones nombradas y se ejecutaron las 12 autenticadas. Se verificaron selección del JSON `local`, headers, body, multipart UTF-8 y captura de IDs entre proyectos e importaciones. Sin escrituras en la base remota. |
| Mismo harness, respuesta auth HTTP `204` | El handler falla y la CLI devuelve código distinto de cero, aunque el estado pertenezca a la familia `2xx`. |
| `node --check scripts/descope/run-auth-request.mts` | Sin errores de sintaxis. Runtime disponible: Node `26.9.0`; no se cambió `engines` del proyecto. |
| `pnpm exec prettier --check scripts/descope/run-auth-request.mts requests/http-client.env.json` | Correcto. |
| `git check-ignore requests/http-client.private.env.json` y lectura de permisos | Archivo ignorado; modo `0600`. No se imprimió su contenido. |

El primer intento dentro del sandbox no pudo arrancar Nest por DNS hacia
`oauth2.googleapis.com` (`ENOTFOUND`). La repetición autorizada con acceso de red
completó la autenticación. El servidor ficticio necesitó asimismo permiso para
escuchar en localhost. No se modificó código del backend para estas limitaciones.

La comprobación final de whitespace se limita a los archivos de este incremento;
el chequeo global detectó espacios finales en un plan de otro trabajo previo que
se preservó. Los enlaces locales de los documentos nuevos y las guías actualizadas
se comprobaron contra el árbol real.

## Límites y continuidad

No se automatizó la interfaz de WebStorm. La compatibilidad se fundamenta en la
documentación oficial y en la ejecución con el subconjunto compartido por httpYac;
el usuario ya había confirmado la petición auth con esa sintaxis en el IDE.
No se ejecutaron las escrituras reales de proyectos e importaciones para comprobar
este cambio de colección: esos recorridos se verificaron con el servidor ficticio.
El JWT expira; se renueva con `pnpm api:auth-test`. Para peticiones manuales hay que
mantener Nest activo y seleccionar `local` en **Run with**.
