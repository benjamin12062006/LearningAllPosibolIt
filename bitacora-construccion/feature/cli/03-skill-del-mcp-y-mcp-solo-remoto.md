# 03 — Skill del MCP y MCP solo remoto en Integraciones

Fecha de creación: 2026-11-21  
Estado: Implementado, pendiente de verificación en producción  
Relacionada con: [01, catálogo y sesión de la CLI](01-catalogo-y-sesion-cli.md) y [02, paridad del MCP con la CLI](02-paridad-del-mcp-con-la-cli.md).  
Revisión de partida: `7a6f234` (`feature/ia-contexto`).

## Necesidad

El usuario pidió quitar de la web la vía local del MCP (stdio, adaptador y credencial `mcp`) y que **Copiar configuración** copie una skill completa del MCP, igual que la CLI: con todo el contexto, y con instrucciones para que el agente la cree o, si ya existe, la actualice. El nombre de cada skill termina en el canal: `ktsu-cli` y `ktsu-mcp`.

## Decisión → aplicación

- **Skill `ktsu-mcp`** en [`skills/ktsu-mcp`](../../../skills/ktsu-mcp/SKILL.md): recorrido conexión → acceso → comprobación → descubrimiento → lecturas → propuestas → informe; [conexión por cliente](../../../skills/ktsu-mcp/references/conexion.md) (Claude Code, Codex, Claude Desktop/web, ChatGPT) con diagnóstico; [recorridos de herramientas](../../../skills/ktsu-mcp/references/herramientas.md), archivos de hasta 1 MiB y feed. Los 55 nombres de herramienta citados se comprobaron contra el catálogo de Nest. No incluye nada local.
- **Nest** sirve las dos skills desde [`published-skills.ts`](../../../src/integrations/published-skills.ts) (antes `cli-skill.ts`), con una lista explícita por skill. Ruta nueva `GET P/integrations/mcp-skill`; el Dockerfile copia `skills/ktsu-mcp`. El e2e recorre las dos rutas y compara la lista servida con todos los archivos de cada carpeta.
- **Web.** La pestaña MCP solo ofrece el MCP remoto: cliente, **Autorizar cuenta para OAuth**, la configuración visible, **Copiar configuración** (la skill `ktsu-mcp` entera con `context`: URL, nombre del servidor, cliente, configuración, cómo iniciar sesión y proyecto), **Copiar URL del MCP** y el inicio de sesión del cliente. Se quitaron el selector de transporte, los avisos de stdio, «Descargar plantilla» y el prompt de «Configurar con un agente externo», que hacía lo mismo que la copia de la skill. Un único `SkillViewer` muestra y copia las dos skills; la skill se carga al abrir la pestaña para que el texto esté listo al hacer clic.
- **Instrucciones de copia** para las dos skills: buscar la carpeta en el directorio de skills del agente, crearla si no existe o actualizarla (sustituir archivos y borrar los que ya no estén) y escribir el contenido literal. La del MCP añade configurar el servidor con `context.configuration`, autorizar en Integraciones → MCP y, después, iniciar sesión.
- El backend conserva la audiencia `mcp` para listar y revocar accesos locales antiguos; la web ya no los emite.

## Comprobaciones

| Comprobación | Resultado |
| --- | --- |
| Nest: `tsc --noEmit` y suites de integraciones (`--runInBand`) | Sin errores; 16 pruebas aprobadas y 1 omitida, incluidas las dos skills servidas. |
| Web: `pnpm test`, `typecheck` y `lint` | 197 pruebas; typecheck sin errores; lint con los 2 avisos previos. |
| Producción | Pendiente de publicar. |
