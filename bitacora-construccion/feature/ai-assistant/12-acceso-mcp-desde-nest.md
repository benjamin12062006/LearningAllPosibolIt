# 12 — Acceso MCP a un proyecto desde Nest

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado para el piloto local.  
Ámbito: Nest, credenciales y propuestas de E6.7.  
Relacionada con: [plan de acceso externo](../../../docs/plans/feature/ai-assistant/07-plan-acceso-externo-y-cli.md), [fuentes 09](../../../docs/fonts/feature/ai-assistant/09-fuentes-de-acceso-externo-y-cli.md), [servidor MCP](../../../../LearningAllPosibolIt-ai/docs/plans/feature/agente/04-plan-servidor-mcp-local.md).  
Revisión de partida: `32caecc` con un primer borrador de Integraciones en el árbol de trabajo.

## Necesidad

Terminar el flujo de una persona que concede acceso a un proyecto, usa el catálogo desde un cliente MCP local y confirma desde Nest una propuesta del cliente. El compilador reportó tres errores en el borrador de Integraciones.

## Evidencia y decisiones

La ficha 09, H2–H3 y E1–E6, fundamenta el uso de la membresía vigente, el secreto opaco y el catálogo que ya usa el chat. Los servicios de hojas conservan las reglas del recurso y la confirmación usa el efecto persistido. La búsqueda pasa por la API de conocimiento existente con el alcance fijado por Nest y una comprobación final de la credencial.

| Evidencia | Decisión aplicada | Código |
| --- | --- | --- |
| Ficha 09, E1–E2 y plan 07, D1–D3 | Emisión idempotente por proyecto. Se devuelve el secreto una vez y se guarda su huella SHA-256. La audiencia y el estado de la delegación se comprueban en cada petición. | [IntegrationsService](../../../src/integrations/integrations.service.ts), [IntegrationsRepository](../../../src/integrations/integrations.repository.ts) y [migración 40](../../../prisma/migrations/20261114170000_create_integration_credentials/migration.sql) |
| Ficha 09, E3–E6 y plan MCP, D2–D6 | Catálogo externo explícito y acotado por rol. Los selectores de libro y hoja son explícitos. Las lecturas y preparaciones usan servicios de dominio. Nest consulta FastAPI con un proyecto y vuelve a autorizar el resultado. | [IntegrationGatewayService](../../../src/integrations/integration-gateway.service.ts) y [AiServiceClient](../../../src/knowledge/ai-service.client.ts) |
| Plan 07, D5 y H6 | La preparación guarda un efecto revisable. La reserva de confirmación vuelve a comprobar delegación y rol bajo el bloqueo que usa la revocación. Las dos vías de propuestas reutilizan el mecanismo de confirmación. | [ProposalDecisions](../../../src/agent-runs/proposal-decisions.ts) y [AgentRunsRepository](../../../src/agent-runs/agent-runs.repository.ts) |

## Contrato y ajustes

- El [contrato HTTP de Integraciones](../../../contracts/integrations/README.md) describe los cuerpos, estados, límites y flujo de revisión. El catálogo pertenece a Nest. GraphQL comparte sus servicios con la pasarela HTTP.
- El MCP carece de un libro implícito de conversación, por lo que recibe el libro o la hoja por argumento. Cada `callId` identifica una preparación para esa credencial. Cambiar sus argumentos devuelve 422.
- Se añadió cuota por persona y proyecto a la pasarela. El resultado de búsqueda vuelve solo tras comprobar la delegación, aun cuando FastAPI ya respondió. Al borrar un proyecto, la base retira también sus credenciales.

## Comprobaciones realmente ejecutadas

| Comprobación | Resultado |
| --- | --- |
| TypeScript, Oxlint y Prettier | Sin errores. |
| `pnpm db:verify` y `prisma migrate diff` contra PGlite | 3 pruebas pasaron. Las 40 migraciones aplicaron y la comparación con el esquema quedó vacía. |
| `pnpm test:features` | 126 suites y 1.934 pruebas pasaron. La ejecución general dejó 2 suites y 6 pruebas omitidas, incluida la integración de ambos repositorios que se ejecutó por separado. |
| Pruebas enfocadas de Integraciones, agente y cobertura C7 | 4 suites y 27 pruebas pasaron. El cliente MCP por `stdio` leyó y buscó en un proyecto, recibió rechazo para otros dos y preparó una propuesta. Una sesión humana de prueba la confirmó. El chat nativo también ejecutó una lectura y una propuesta mediante FastAPI. |
| Nest y FastAPI arrancados en loopback | Módulo raíz de Nest con base PGlite, FastAPI real y Qdrant 1.19.1 desechable. Se usaron un modelo guionizado, embeddings deterministas y sesiones de prueba. |

| Defecto deliberado en copia temporal | La prueba falló al comprobar |
| --- | --- |
| N1, audiencia omitida | La credencial de otra audiencia se rechaza. |
| N2, revocación omitida | Una credencial revocada pierde el catálogo. |
| N3, expiración omitida | Una credencial que llega a su vencimiento se rechaza. |
| N4, cuota desplazada | La petición que supera el límite da 429. |
| N5, revocación omitida en la reserva de confirmación | La propuesta pendiente deja de ser confirmable. |
| N6, revalidación omitida al terminar una búsqueda | Una revocación durante la consulta impide devolver resultados. |
| N7, argumentos ignorados al deduplicar | Un `callId` repetido con otros argumentos se rechaza. |

Los siete defectos compilaron y cada uno hizo fallar su prueba. Las migraciones de Cloud SQL y el recorrido de la web con Descope y Vertex AI se verifican por separado.
