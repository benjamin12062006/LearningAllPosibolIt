# 10 — Fuentes del chat de proyecto

Fecha: 2026-11-15

- [Plan del catálogo y las ejecuciones](../../../plans/feature/ai-assistant/05-plan-catalogo-ejecuciones-y-confirmaciones.md). El contrato de Nest a FastAPI ya prevé contexto de proyecto, libro y hoja. El repositorio de conversaciones implementó los dos últimos al comienzo.
- [Catálogo de operaciones](../../../../src/agent-runs/operations/agent-operation-catalog.ts). Los servicios de catálogo, reglas, evaluaciones, feed y productos comprueban su propio acceso. La pasarela del agente limita las operaciones al proyecto de la ejecución.
- [DTO de FastAPI](../../../../../LearningAllPosibolIt-ai/src/ktsu_ai/http/agent_http/agent_dto.py). Admite contexto sin libro ni hoja.
- [WorkspacePage de Nuxt](../../../../../LearningAllPosibolIt-web/app/components/WorkspacePage.vue). Ya monta el panel desde las secciones del proyecto. El bloqueo del formulario proviene del contexto requerido por el chat.
