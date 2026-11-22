# 05 — Aplicar los cambios sin aprobación humana

Fecha de creación: 2026-11-21  
Revisión de partida: `3e8ef8a` (`deploy/vercel`)  
Relacionada con: [02, paridad del MCP y la CLI](../../../../bitacora-construccion/feature/cli/02-paridad-del-mcp-con-la-cli.md), [fuentes de la IA con contexto (E3)](../../../fonts/feature/ai-assistant/12-fuentes-ia-con-contexto-memoria-y-toon.md) y [`auto-confirm.ts`](../../../../src/agent-runs/auto-confirm.ts).

## Necesidad

El usuario pidió (2026-11-21) que ninguna escritura espere a que una persona abra una URL y confirme una propuesta: la CLI, el MCP, el chat de la web y cualquier integración deben ejecutar la acción en la misma llamada, sin interruptor de configuración.

## Punto de partida (evidencia del código)

- `AI_AUTO_CONFIRM` ya aplica en la misma llamada con la misma confirmación que usa la web (`ProposalDecisions.confirm`: plan guardado, hash, permisos vigentes, credencial activa). Solo se activaba con la variable a `true`, y en Vercel no estaba (bitácora 02).
- `IntegrationGatewayService.call` excluía la CLI: `!cli && this.autoConfirm`. Por eso la CLI devolvía `reviewPath` y la skill enviaba a la web.
- El MCP (`_prepared`), la IA (`NestOperationGateway`, `status == "confirmed"`) y la tarjeta del chat ya entienden una respuesta `confirmed`.

## Decisión

1. `aiAutoConfirmFrom` devuelve `true` siempre fuera de las pruebas. Solo la suite (`NODE_ENV=test`) puede pedir el flujo manual con `AI_AUTO_CONFIRM=false`, para seguir cubriendo el código de propuestas y su página de revisión, que se conservan para las propuestas antiguas.
2. Quitar la excepción de la CLI en la pasarela externa.
3. La CLI deja de ofrecer `proposals review`; `prepare` devuelve el resultado aplicado.
4. Textos: instrucciones del MCP, prompt de la IA, etiquetas de Integraciones y las skills `ktsu-cli` / `ktsu-mcp` dejan de hablar de revisión humana.
5. Se mantienen los permisos por rol y la capacidad de escritura que la persona concede al conectar una credencial: la aplicación sigue actuando en su nombre y con sus permisos.

## Verificación prevista

Pruebas de la pasarela (CLI y MCP aplican al momento), suite de agent-runs, despliegue de `deploy/vercel` (api, web, ai) y `deploy/vercel-mcp`, y una escritura real por CLI que vuelva `status: confirmed` sin URL.
