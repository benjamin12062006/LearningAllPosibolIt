# 18 — Confirmar una propuesta y continuar el chat

Fecha de creación: 2026-11-21  
Estado: Implementado en `feature/ia-contexto`. Migración de producción pendiente.  
Relacionada con: [plan 10, E4](../../../docs/plans/feature/ai-assistant/10-plan-ia-con-contexto-memoria-y-toon.md).

La confirmación del chat puede encolar otra ejecución con el contexto del turno y un mensaje de la persona. Si un error conocido impide aplicar, queda `failed` con su motivo, y la continuación recibe ese resultado. La persistencia permite comprobar la idempotencia al repetir la confirmación. Rechazar termina la propuesta. Cuando la cuota impide continuar, la respuesta conserva el resultado de la acción e indica el motivo. Nuxt muestra ese fallo y sigue la continuación cuando existe. [Servicio](../../../src/agent-runs/agent-runs.service.ts) · [Pruebas del chat](../../../test/features/agent-runs/agent-runs.e2e-spec.ts)

La migración añade `ai_proposals.error` como nullable y exige un error únicamente para el estado `failed`. La comprobación de despliegue debe confirmar que se aplicó en Neon antes de que Nest lea o escriba esa columna. [Migración](../../../prisma/migrations/20261121120000_add_ai_proposal_failure/migration.sql)

Los registros de la comprobación original de E4 muestran 9 de 10 defectos detectados. El caso que quedó sin detectar intentaba provocar una continuación tras rechazar. El escenario de rechazo está cubierto en la suite E4. En el cierre se corrigió la coma faltante en el mensaje traducido de Nuxt, y la web pasó 196 pruebas y `typecheck`.
