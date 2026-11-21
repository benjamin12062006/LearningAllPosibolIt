# Conectar el MCP remoto

La URL del servidor aparece en **Integraciones → MCP** («Copiar URL del MCP»); en producción es `https://ktsu-mcp.vercel.app/mcp`. El nombre recomendado del servidor es `ktsu-remoto`. Conserva las demás entradas MCP que ya tenga el cliente: añade o actualiza solo esta.

Antes de iniciar sesión, la persona pulsa **Autorizar cuenta para OAuth** en **Integraciones → MCP** del proyecto, con la misma cuenta que usará en Descope.

## Por cliente

| Cliente | Añadir el servidor | Iniciar sesión |
| --- | --- | --- |
| Claude Code | `claude mcp add --transport http ktsu-remoto '<URL_MCP>'` | Abrir `/mcp` en Claude Code, elegir `ktsu-remoto` y autenticar. |
| Codex | En `~/.codex/config.toml`: `[mcp_servers.ktsu-remoto]` y `url = "<URL_MCP>"` | `codex mcp login ktsu-remoto` |
| Claude Desktop y Claude web | Añadir un conector personalizado con la URL del MCP. | Completar OAuth con Descope desde el conector. |
| ChatGPT | En Plugins, añadir un servidor MCP personalizado con la URL HTTPS, desde un espacio que permita conectores personalizados. | Completar OAuth con Descope. |

Las herramientas aparecen en sesiones nuevas del cliente. Si el servidor se añadió con la sesión abierta, abre otra.

## Diagnóstico

| Síntoma | Qué hacer |
| --- | --- |
| El cliente no muestra herramientas de `ktsu-remoto` | Comprobar la URL, abrir una sesión nueva y repetir el inicio de sesión. |
| 401 en todas las llamadas | La sesión caducó o se revocó: volver a iniciar sesión desde el cliente. |
| `INTEGRATION_OAUTH_GRANT_REQUIRED` | Falta la autorización del proyecto o venció. Pulsar **Autorizar cuenta para OAuth** en Integraciones → MCP y después volver a iniciar sesión. |
| Falta una herramienta de escritura | La sesión no tiene la capacidad de preparar o el rol no lo permite. Confirmar con el titular el alcance necesario. |
| `AGENT_RESULT_TOO_LARGE` al leer un archivo | El archivo supera 1 MiB: descargarlo desde la web o con la CLI de KTSU. |
| `search_knowledge` devuelve vacío | El índice del proyecto aún no tiene contenido; no es un error. |
