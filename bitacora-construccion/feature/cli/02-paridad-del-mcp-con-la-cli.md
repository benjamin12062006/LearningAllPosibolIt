# 02 — El MCP hace lo mismo que la CLI

Fecha de creación: 2026-11-21  
Estado: Implementado y verificado  
Revisión de partida: `89a352e` (`feature/ia-contexto`, desplegada en `deploy/vercel` como `3896d0f`)  
Relacionada con: [01, catálogo y sesión de la CLI](01-catalogo-y-sesion-cli.md), [plan 10 de ai-assistant](../../../docs/plans/feature/ai-assistant/10-plan-ia-con-contexto-memoria-y-toon.md) y la [skill `ktsu-cli`](/Users/benji/.claude/skills/ktsu-cli/references/comandos.md).

## Necesidad

El usuario pidió comprobar que el MCP tenga todas las funciones de la CLI y añadir las que falten. Comparando la [referencia de comandos de la CLI](/Users/benji/.claude/skills/ktsu-cli/references/comandos.md) con la pasarela [`IntegrationGatewayService`](../../../src/integrations/integration-gateway.service.ts):

| Función de la CLI | MCP antes | MCP ahora |
| --- | --- | --- |
| `operations list` / `describe`, `read`, `prepare` sobre `DELEGATED_OPERATIONS` (32) | Sí | Sí |
| Las 26 de `CLI_OPERATIONS`: las 18 del plan 10 (borradores, duplicar, exportar, vistas, mapeos, catálogo y configuración del feed) y 8 de feed solo de la CLI (`create_feed`, `list_feed_versions`, `get_feed_delivery_status`, `get_feed_configuration`, `get_feed_refresh`, `refresh_feed`, `republish_feed_version`, `disable_feed_delivery`) | No | Sí |
| `proposals status` | No | `get_proposal_status` |
| `proposals download` (exportación de hoja) | No | `read_worksheet_export_file` |
| `exports download` | No | `read_catalog_export_file` |
| `feed download` | No | `read_feed_version_file` |
| `auth`, `config`, `proposals review`, `feed delivery` (enlaces a la web) | No aplica: son de la terminal y de su perfil, no del proyecto | — |

## Decisión → aplicación

- **Mismo catálogo para los dos canales externos.** `selectorsOf(name)` une `CLI_OPERATIONS` y `DELEGATED_OPERATIONS` para la CLI y para el MCP. `operations` y `call` usan `catalog.all(true)` y `catalog.find(name, true)`. Los permisos por rol, la capacidad `prepare` de la credencial y los selectores obligatorios siguen igual. La confirmación automática solo afecta al MCP, como antes (`AI_AUTO_CONFIRM`, que en Vercel no está activa).
- **Las rutas propias de la CLI, como herramientas.** [`credential-tools.ts`](../../../src/integrations/credential-tools.ts) declara cuatro lecturas que la pasarela atiende en `callCredentialTool` / `readForCredential` antes del catálogo. Usan los mismos servicios que [`CliIntegrationController`](../../../src/integrations/cli-integration.controller.ts), que ahora comparte `proposalAccess`, `reader` y `confirmedWorksheetExportId`. Las cuatro también aparecen en la CLI (paridad en los dos sentidos).
- **Archivos en la respuesta.** Un cliente MCP no escribe en el disco de la persona. Por eso el archivo vuelve como `{ fileName, contentType, encoding, bytes, content }`: texto UTF-8 para CSV/TSV y base64 para XLSX. El tope es de 1 MiB (`CREDENTIAL_FILE_MAX_BYTES`); si lo pasa, responde `AGENT_RESULT_TOO_LARGE` y hay que usar la CLI o la web.
- El servidor MCP de FastAPI no cambia: pide la lista a Nest en cada `tools/list` y en cada `tools/call`.

## Comprobaciones realmente ejecutadas

- `tsc --noEmit` sin errores; `pnpm lint` solo con el aviso que ya existía (`catalog-rules-operations.ts:268`); Prettier aplicado.
- E2E nueva en [`integrations.e2e-spec.ts`](../../../test/features/integrations/integrations.e2e-spec.ts), «el MCP tiene lo mismo que la CLI…». Comprueba:
  - las operaciones de la CLI y las cuatro herramientas nuevas en el catálogo del MCP, con `worksheetId` obligatorio en `export_worksheet`;
  - `export_worksheet` preparada desde el MCP, con su estado `ready`;
  - sin confirmar no hay archivo (404 `WORKSHEET_EXPORT_NOT_FOUND`); tras confirmar en la web, el estado es `confirmed` y llega el CSV con su BOM;
  - una propuesta ajena da 404, un ID mal escrito 400 y pedir una lectura en modo `prepare` 400.
- Suites `integrations`, `complete-access` y `agent-runs`: 77 pasan y 2 se omiten.
- Batería completa de Nest y web (199 pruebas) antes de publicar: anotadas en el commit y en el despliegue.

## Consecuencias

- Una credencial MCP ve ahora tantas herramientas como la CLI. Las escrituras siguen siendo propuestas que la persona confirma en la web.
