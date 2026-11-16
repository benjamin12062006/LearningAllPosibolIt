# 01 — Fuentes de la CLI y la skill

Fecha de creación: 2026-11-14  

El [plan de acceso externo](../../../plans/feature/ai-assistant/07-plan-acceso-externo-y-cli.md) define audiencia CLI, proyecto fijo, catálogo y confirmación humana. La CLI reutiliza los servicios que ya usa la [pasarela de integración](../../../../src/integrations/integration-gateway.service.ts). Se usa la biblioteca estándar de Node 24 para parsear opciones, manejar perfiles y llamar a las rutas públicas de Nest. [Documentación de Node](https://nodejs.org/docs/latest-v24.x/api/util.html#utilparseargsconfig)
