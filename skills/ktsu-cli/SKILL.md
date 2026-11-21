---
name: ktsu-cli
description: Usa la CLI incluida en esta skill para leer y preparar cambios en un proyecto KTSU (hojas, borradores, vistas, mapeos, catálogo, reglas, evaluaciones, exportaciones y feeds de Merchant Center). Úsala cuando el usuario pida consultar o modificar su proyecto KTSU desde la terminal, comprobar su acceso CLI, descargar exportaciones o versiones del feed, o seguir una propuesta pendiente. Las escrituras quedan como propuestas que el titular revisa y decide en la web de KTSU.
---

# CLI de KTSU

La CLI está dentro de esta skill, en [scripts/ktsu-cli](scripts/ktsu-cli). No hay que descargarla ni instalarla: necesita Node 24+ y no tiene dependencias. Ejecuta cada comando desde esa carpeta con `pnpm run ktsu <comando>`, o con `node bin/ktsu.mjs <comando>` si no hay pnpm. La [referencia de comandos](references/comandos.md) recoge todos los comandos, opciones, variables y errores.

## Recorrido

1. **Destino.** Identifica con el usuario la organización y el proyecto. Si `pnpm run ktsu config show` no tiene `apiUrl`, `webUrl` y `projectId`, configúralos con los valores de **Integraciones → CLI** según el [procedimiento de acceso](references/acceso.md). Para otro destino, usa un `KTSU_CONFIG_PATH` propio en vez de sobrescribir el perfil.
2. **Acceso.** Ejecuta `pnpm run ktsu auth status --json`. Si falla, indica al usuario que autorice OAuth o emita una credencial en **Integraciones → CLI**. Con OAuth, ejecuta `auth login`. Con credencial, el usuario la inyecta en `KTSU_TOKEN` o por `--token-stdin`.
3. **Comprobación.** Ejecuta `pnpm run ktsu read get_project_overview --json` y confirma el nombre del proyecto antes de seguir.
4. **Descubrimiento.** Lista con `operations list` y lee el esquema con `operations describe <operación>` antes de escribir cada `--input`. Obtén los IDs con lecturas del mismo proyecto y sigue los cursores de los resultados paginados.
5. **Lecturas.** Usa `read <operación> --input <archivo.json>`.
6. **Cambios.** Usa `prepare <operación> --input <archivo.json>`. Entrega `reviewUrl` al usuario, guarda `proposalId` y `callId`, y espera a que decida en la web. Después consulta `proposals status <proposalId>` y relee el dato afectado.
7. **Informe.** Indica qué lectura quedó verificada, qué propuesta está pendiente o qué `code` y `requestId` devolvió la API.

Para hojas, borradores, catálogo, reglas y evaluaciones, sigue los [recorridos de operaciones](references/operaciones.md). Para un feed, sigue el [recorrido de Merchant Center](references/feed.md).

## Reglas

- Nunca pidas ni muestres secretos en el chat, en argumentos, en `config.json` ni en archivos compartidos. La sesión OAuth vive en el llavero; la credencial, en el gestor de secretos del usuario.
- La CLI no confirma propuestas. Solo una persona con sesión en la web puede confirmarlas o rechazarlas.
- Respeta el alcance y las capacidades que devuelve `auth status`. Si falta un permiso, explícalo en vez de buscar otra vía.
- Al reintentar un `prepare` incierto, reutiliza el mismo `--call-id` con los mismos argumentos.
- No modifiques los archivos de esta skill: son la copia exacta que publica KTSU en **Integraciones → CLI**.
