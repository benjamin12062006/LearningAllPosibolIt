---
name: ktsu-cli
description: Usa la CLI incluida en esta skill para leer y aplicar cambios en un proyecto KTSU (hojas, borradores, vistas, mapeos, catálogo, reglas, evaluaciones, exportaciones y feeds de Merchant Center). Úsala cuando el usuario pida consultar o modificar su proyecto KTSU desde la terminal, comprobar su acceso CLI, descargar exportaciones o versiones del feed, o consultar el estado de un cambio. Las escrituras se aplican al momento, en nombre del titular y con sus permisos; no hay que aprobar nada en la web.
---

# CLI de KTSU

La CLI está dentro de esta skill, en [scripts/ktsu-cli](scripts/ktsu-cli). No hay que descargarla ni instalarla: necesita Node 24+ y no tiene dependencias. Ejecuta cada comando desde esa carpeta con `pnpm run ktsu <comando>`, o con `node bin/ktsu.mjs <comando>` si no hay pnpm. La [referencia de comandos](references/comandos.md) recoge todos los comandos, opciones, variables y errores.

## Recorrido

1. **Destino.** Identifica con el usuario la organización y el proyecto. Si `pnpm run ktsu config show` no tiene `apiUrl`, `webUrl` y `projectId`, configúralos con los valores de **Integraciones → CLI** según el [procedimiento de acceso](references/acceso.md). Para otro destino, usa un `KTSU_CONFIG_PATH` propio en vez de sobrescribir el perfil.
2. **Acceso.** Ejecuta `pnpm run ktsu auth status --json`. Si falla, indica al usuario que autorice OAuth o emita una credencial en **Integraciones → CLI**. Con OAuth, ejecuta `auth login`. Con credencial, el usuario la inyecta en `KTSU_TOKEN` o por `--token-stdin`.
3. **Comprobación.** Ejecuta `pnpm run ktsu read get_project_overview --json` y confirma el nombre del proyecto antes de seguir.
4. **Descubrimiento.** Lista con `operations list` y lee el esquema con `operations describe <operación>` antes de escribir cada `--input`. Obtén los IDs con lecturas del mismo proyecto y sigue los cursores de los resultados paginados.
5. **Lecturas.** Usa `read <operación> --input <archivo.json>`.
6. **Cambios.** Usa `prepare <operación> --input <archivo.json>`. KTSU lo aplica en la misma llamada: la respuesta trae `status: confirmed` y `result`. Guarda `proposalId` y `callId`, sigue con el siguiente paso de la tarea sin esperar a nadie y relee el dato afectado. Si la respuesta es un error, informa del `code`.
7. **Informe.** Indica qué lectura quedó verificada, qué cambio quedó aplicado (con su resultado) o qué `code` y `requestId` devolvió la API.

Para hojas, borradores, catálogo, reglas y evaluaciones, sigue los [recorridos de operaciones](references/operaciones.md). Para un feed, sigue el [recorrido de Merchant Center](references/feed.md).

## Reglas

- Nunca pidas ni muestres secretos en el chat, en argumentos, en `config.json` ni en archivos compartidos. La sesión OAuth vive en el llavero; la credencial, en el gestor de secretos del usuario.
- No hay paso de aprobación: no envíes al usuario a la web para confirmar. Comprueba cada cambio releyendo el dato.
- Respeta el alcance y las capacidades que devuelve `auth status`. Si falta un permiso, explícalo en vez de buscar otra vía.
- Al reintentar un `prepare` incierto, reutiliza el mismo `--call-id` con los mismos argumentos.
- No modifiques los archivos de esta skill: son la copia exacta que publica KTSU en **Integraciones → CLI**.
