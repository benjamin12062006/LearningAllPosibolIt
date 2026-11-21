# 19 — Operaciones de hojas, catálogo y feed para el asistente

Fecha de creación: 2026-11-21  
Estado: Implementado en `feature/ia-contexto`.  
Relacionada con: [plan 10, E5](../../../docs/plans/feature/ai-assistant/10-plan-ia-con-contexto-memoria-y-toon.md) y [plan para la CLI y MCP](../../../docs/plans/feature/cli/02-plan-catalogo-completo-y-distribucion-cli.md).

El catálogo incorporó 18 operaciones. Las operaciones de borrador llaman a los servicios de revisión y permiten enviar, rechazar, reabrir, rebasar y preparar la reversión. El segundo grupo duplica y exporta hojas, abre una importación del catálogo como hoja y administra vistas y mapeos. El tercero lista y borra importaciones y prepara cambios de fuente, horario y política del feed. Las escrituras reutilizan el flujo de propuestas y los permisos de las rutas web. `suggest_view` admite vistas de equipo y conserva la interpretación personal de las propuestas antiguas. [Catálogo](../../../src/agent-runs/operations/agent-operation-catalog.ts)

La suite de seis casos E2E cubre el catálogo y roles, los recorridos de borrador y rebase, duplicación, exportación y vistas, mapeos, catálogos de otro proyecto y configuración del feed. La matriz de operaciones y el recorrido externo quedan descritos en el plan CLI, ya que la lista delegada de Nest todavía requiere las nuevas entradas. [Pruebas E2E](../../../test/features/agent-runs/complete-access-operations.e2e-spec.ts)

Los seis casos pasaron en una copia local con PGlite. Se detectaron tres defectos introducidos por separado en una copia del código compilado. El catálogo sin `rebase_changeset` y el permiso que dejaba a un editor cambiar el horario hicieron fallar el caso de catálogo y roles. Forzar las vistas de equipo a personales hizo fallar el caso de hojas, vistas y mapeos.
