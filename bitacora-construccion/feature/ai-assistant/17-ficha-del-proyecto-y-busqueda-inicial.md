# 17 — Ficha del proyecto y conocimiento antes de responder

Fecha de creación: 2026-11-21  
Estado: Implementado en `feature/ia-contexto`.  
Relacionada con: [plan 10, E3](../../../docs/plans/feature/ai-assistant/10-plan-ia-con-contexto-memoria-y-toon.md) y [memoria entre mensajes](16-memoria-entre-mensajes.md).

`ProjectBriefing.of` reutiliza `get_project_overview`, consulta las hojas activas y las columnas de su revisión de esquema vigente y añade hasta diez acciones confirmadas por la persona en el proyecto. La ficha indica cuando sus límites omiten hojas o columnas. El worker la envía con cada ejecución y puede continuar sin ella si ocurre un fallo. [Ficha de Nest](../../../src/agent-runs/project-briefing.ts)

FastAPI busca en Qdrant antes de invocar al modelo usando la pregunta actual y hasta dos anteriores de esa persona. La consulta lleva el alcance de la ejecución. La ficha y el conocimiento pasan por la representación TOON. Una búsqueda lenta o fallida deja seguir la ejecución. [Agente Python](../../../../ai/src/ktsu_ai/application/agent_application/agent_service.py)

## Evidencia de verificación

- Las pruebas Python de contexto cubren la entrada de la ficha, alcance de la búsqueda, límite de consulta y recuperación ante Qdrant caído o lento. Pasaron en la batería de FastAPI. [Pruebas](../../../../ai/tests/unit/test_agent_context.py)
- Las pruebas Nest de E3 verifican que las hojas archivadas, los libros archivados y las columnas de otro esquema quedan fuera, y que un nuevo chat recibe las acciones confirmadas. [Pruebas](../../../test/features/agent-runs/agent-runs.e2e-spec.ts)
- El registro previo de defectos detectó seis casos. El ensayo actual pasó con el código original y falló al permitir columnas de otras versiones del esquema en una copia temporal. Queda comprobado el séptimo caso con el fixture actualizado.
