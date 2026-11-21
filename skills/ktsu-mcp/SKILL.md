---
name: ktsu-mcp
description: Usa el servidor MCP remoto de KTSU (ktsu-remoto, OAuth con Descope) para leer y preparar cambios en un proyecto KTSU (hojas, borradores, vistas, mapeos, catálogo, reglas, evaluaciones, exportaciones y feeds de Merchant Center). Úsala cuando el usuario pida trabajar su proyecto KTSU desde un cliente MCP (Claude Code, Codex, Claude Desktop, Claude web o ChatGPT), conectar o diagnosticar ese MCP, o seguir una propuesta pendiente. Las escrituras quedan como propuestas que el titular revisa y decide en la web de KTSU.
---

# MCP de KTSU

KTSU publica un servidor MCP remoto con transporte HTTP y OAuth. No hay nada que instalar ni secretos que copiar: el cliente se conecta a la URL del MCP y la persona inicia sesión con Descope. Cada sesión actúa sobre **un proyecto**, el que la persona autorizó en **Integraciones → MCP**.

## Recorrido

1. **Conexión.** Busca las herramientas del servidor `ktsu-remoto` en la sesión (en Claude Code aparecen como `mcp__ktsu-remoto__*`). Si no están, añade el servidor con la configuración de tu cliente según la [guía de conexión](references/conexion.md) y pide a la persona que complete el inicio de sesión.
2. **Acceso.** El orden importa: primero la persona pulsa **Autorizar cuenta para OAuth** en **Integraciones → MCP** del proyecto; después inicia sesión desde el cliente. Si una herramienta devuelve `INTEGRATION_OAUTH_GRANT_REQUIRED`, falta esa autorización o se hizo después del login: autorizar y volver a iniciar sesión.
3. **Comprobación.** Llama a `get_project_overview` y confirma con la persona el nombre del proyecto antes de seguir.
4. **Descubrimiento.** Las herramientas disponibles dependen del rol y de las capacidades de la sesión. Lee el esquema de cada herramienta antes de llamarla. Obtén los IDs con lecturas del mismo proyecto y sigue los cursores de los resultados paginados.
5. **Lecturas.** Llama a las herramientas de lectura con los argumentos del esquema.
6. **Cambios.** Una herramienta de escritura **prepara una propuesta**. Entrega a la persona el resumen y el `reviewPath` (en la web, `https://<web>/<reviewPath>`), espera a que decida y consulta `get_proposal_status`. Después relee el dato afectado.
7. **Informe.** Indica qué lectura quedó verificada, qué propuesta está pendiente (con su ruta) o qué `code` devolvió la herramienta.

Para hojas, borradores, catálogo, reglas, evaluaciones, archivos y feed, sigue los [recorridos de herramientas](references/herramientas.md).

## Reglas

- Nunca pidas ni muestres tokens o secretos en el chat ni en archivos. El inicio de sesión ocurre en el navegador con Descope.
- El MCP no confirma propuestas. Solo una persona con sesión en la web puede confirmarlas o rechazarlas. No lo hagas en su nombre con scripts ni llamadas directas a la API.
- Los IDs salen de las herramientas; no los inventes.
- Varias lecturas devuelven una muestra y un total (`truncated`, `total`). No afirmes «todas» viendo solo la muestra.
- Respeta el alcance de la sesión. Si falta una herramienta o un permiso, explícalo en vez de buscar otra vía.
- No modifiques los archivos de esta skill: son la copia exacta que publica KTSU en **Integraciones → MCP**.
