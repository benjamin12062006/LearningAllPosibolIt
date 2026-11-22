# 05 — Los cambios se aplican sin aprobación humana

Fecha de creación: 2026-11-21  
Estado: Implementado, pendiente de verificación en producción  
Revisión de partida: `3e8ef8a` (`deploy/vercel`)  
Relacionada con: [plan 05 de cli](../../../docs/plans/feature/cli/05-plan-aplicar-sin-aprobacion.md), [02, paridad del MCP y la CLI](02-paridad-del-mcp-con-la-cli.md) y [contrato externo](../../../contracts/integrations/README.md).

## Necesidad

El usuario vio que la skill `ktsu-cli` le devolvía una URL de `/integrations/proposals/<id>` para confirmar un borrador y pidió quitar esa barrera en todos los canales: CLI, MCP, chat de la web e integraciones. Las acciones se ejecutan al momento y sin configuración.

## Evidencia de partida

- [`auto-confirm.ts`](../../../src/agent-runs/auto-confirm.ts) ya tenía la aplicación inmediata, detrás de `AI_AUTO_CONFIRM=true`, que en Vercel no estaba activa (bitácora 02).
- [`IntegrationGatewayService.call`](../../../src/integrations/integration-gateway.service.ts) dejaba fuera a la CLI con `!cli && this.autoConfirm`.
- El MCP (`_prepared` en `ktsu_ai/mcp_server/server.py`), la IA (`NestOperationGateway`) y `ProposalCard.vue` ya interpretaban `status: confirmed`.

No se consultaron cursos: el cambio reutiliza un mecanismo propio ya probado (fuentes de E3 en [ai-assistant 12](../../../docs/fonts/feature/ai-assistant/12-fuentes-ia-con-contexto-memoria-y-toon.md)).

## Decisión → aplicación

| Decisión | Dónde |
| --- | --- |
| Aplicar siempre fuera de las pruebas; la variable ya no desactiva nada en producción | `aiAutoConfirmFrom` en `src/agent-runs/auto-confirm.ts` |
| La CLI también aplica al momento | `IntegrationGatewayService.call` (sin `!cli`); la respuesta incluye `error` si la propuesta quedó `failed` |
| La suite sigue cubriendo el flujo antiguo de propuesta (página de revisión para propuestas viejas) | `test/features/support/isolated-env.ts` fija `AI_AUTO_CONFIRM=false`; las pruebas de aplicación inmediata sobrescriben el proveedor a `true` |
| La CLI ya no ofrece `proposals review` ni construye `reviewUrl` | `skills/ktsu-cli/scripts/ktsu-cli/bin/ktsu.mjs` (`invoke`) |
| Las skills `ktsu-cli` y `ktsu-mcp` dejan de mandar a la web | `skills/*/SKILL.md` y `references/` |
| El MCP anuncia que las escrituras se aplican al momento | `INSTRUCTIONS` y `WRITE_NOTE` (repo IA, ramas `deploy/vercel` y `deploy/vercel-mcp`) |
| La IA del chat no pide permiso para escribir | `SYSTEM_PROMPT` en `llamaindex_agent.py` (repo IA, `deploy/vercel`) |
| Integraciones: «Lectura y cambios», casilla de escritura marcada por defecto; tarjeta «Cambio aplicado» | `AccessPanel.vue`, `ProposalCard.vue`, `locales/en.ts` (repo web, `deploy/vercel`) |

Se mantienen los permisos por rol y la capacidad `prepare` de cada credencial: la aplicación actúa en nombre de la persona y con sus permisos; un lector no puede escribir.

## Comprobaciones

- API, suites afectadas (`auto-confirm`, `project-actions`, `integrations.e2e`, `complete-access-operations`, `agent-runs.e2e`): 63 pasan, 1 omitida. Incluye la prueba nueva «la CLI también aplica en la misma llamada, sin enlace de revisión» y la suite E5 de la CLI, que ahora comprueba `status: confirmed` sin `reviewPath`.
- API, suite completa: 2014 pasan y 1 falla, `graphql/coverage.spec` («la matriz tiene exactamente las rutas montadas»), por `GET …/integrations/mcp-skill`, una ruta de `55bf0e6` que falta en la matriz. Es anterior a este cambio.
- API: `tsc --noEmit` y `oxlint` sin errores nuevos.
- Repo IA (`deploy/vercel` y `deploy/vercel-mcp`): `ruff check`/`format` y 110 pruebas unitarias en cada rama.
- Web: `eslint` de los archivos tocados y `vitest` (198 pruebas).

Pendiente: despliegue y una escritura real por CLI en producción.
