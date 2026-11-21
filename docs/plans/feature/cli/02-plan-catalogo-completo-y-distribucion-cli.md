# 02 — Llevar el catálogo del asistente a la CLI de KTSU

Fecha de creación: 2026-11-21  
Estado: Plan  
Revisión de partida: `feature/ia-contexto` desde `55a04a1`, con E1–E5 en el árbol de trabajo.  
Relacionada con: [CLI privada](01-plan-cli-y-skill-ktsu.md), [plan 10 del asistente](../ai-assistant/10-plan-ia-con-contexto-memoria-y-toon.md), [contrato externo](../../../../contracts/integrations/README.md) y [plan de MCP](../../../../../ai/docs/plans/feature/agente/06-plan-catalogo-completo-mcp.md).

## Objetivo

Que `ktsu operations list` y `describe` ofrezcan todas las operaciones del catálogo que la credencial y la membresía realmente permiten. Cada comando debe guiar desde la obtención de IDs hasta la lectura o la revisión y el resultado de una propuesta.

## Operaciones nuevas

El catálogo del chat ya las registra. `IntegrationGatewayService` mantiene la lista compartida `DELEGATED_OPERATIONS` y aún no contiene estas 18 entradas. TOON, el historial de mensajes y la ficha del agente pertenecen al contexto que usa el chat. La CLI consume las operaciones de dominio por JSON, con `get_project_overview` y `search_knowledge` para recuperar contexto deliberadamente. [Catálogo](../../../../src/agent-runs/operations/agent-operation-catalog.ts) · [Pasarela](../../../../src/integrations/integration-gateway.service.ts)

| Área | Lecturas | Preparación y revisión |
| --- | --- | --- |
| Borradores | Consultar el borrador, sus revisiones y los conflictos con las lecturas existentes. | `submit_changeset`, `reopen_changeset`, `reject_changeset`, `rebase_changeset`, `propose_revert`. |
| Hojas y vistas | `list_saved_views`. | `duplicate_worksheet`, `open_catalog_as_worksheet`, `update_saved_view`, `export_worksheet`. Comprobar también `suggest_view` con visibilidad de equipo y las propuestas antiguas de vistas personales. |
| Mapeos | `list_import_mappings`. | `create_import_mapping`, `delete_import_mapping`. |
| Catálogo y feed | `list_catalog_imports`. | `delete_catalog_import`, `set_feed_source`, `set_feed_schedule`, `approve_feed_policy`. Probar el proceso posterior con las lecturas de estado y publicación ya existentes. |

## Implementación propuesta

1. Completar una sola lista de operaciones externas en Nest. Por cada entrada, declarar los selectores explícitos que un cliente externo debe enviar para evitar inferencias del chat. Usar el mismo filtro en descubrimiento y ejecución. Cubrir cada permiso y ámbito con casos de organización ajena, rol limitado, credencial revocada y selectores insuficientes. Contrastar la lista externa con el catálogo interno y registrar las exclusiones deliberadas del producto.
2. Reutilizar `ktsu read <operación>` y `ktsu prepare <operación> --input <archivo>`. Mantener JSON estructurado, códigos de error y la idempotencia por `callId`. Al preparar, devolver el enlace de revisión y el alcance del cambio. Añadir una consulta externa de **estado de propuesta** solo si hace falta para que la CLI pueda comprobar después `confirmed`, `failed`, `rejected` o `expired`, con alcance del titular y credencial vigente. Una exportación devuelve el artefacto después de confirmar, respetando permisos y vida útil del archivo. La reanudación automática tras confirmar pertenece al chat.
3. En Nuxt, reutilizar **Integraciones** y la página de revisión. Mostrar método de instalación, comandos para descubrir y describir operaciones y permisos de lectura o preparación. En revisión, mostrar entidad, efecto, estado y motivo de fallo. Mantener confirmación humana y revalidación de rol y proyecto, incluso si el chat tiene auto-confirmación habilitada. Medir y conservar el comportamiento documentado de la API antes de aplicar cada cambio.
4. Entregar OAuth interactivo como incremento de autenticación. En el mismo proyecto Descope, registrar un cliente público dedicado para CLI con código y PKCE, validar `state` y usar callback en loopback. Guardar los tokens en el llavero y comprobar issuer, audiencia, scope CLI y concesión del proyecto en Nest. Añadir `ktsu auth login`, `auth status` y `auth logout`. Mantener el formato explícito de credenciales de proyecto para scripts. [Descope y clientes CLI](https://docs.descope.com/identity-federation/inbound-apps/creating-inbound-apps)
5. Distribuir la CLI inicialmente desde un checkout autorizado de Nest. El manifiesto declara `@ktsu/cli` privado, ejecutable `ktsu` y Node 24+. Desde la raíz, `npm install -g ./packages/ktsu-cli`. Para usuarios sin checkout, generar un `.tgz` desde la misma revisión con `npm pack ./packages/ktsu-cli` y adjuntarlo como artefacto en una entrega privada si se autoriza. Verificar el contenido y la versión antes de distribuir. [Manifiesto](../../../../packages/ktsu-cli/package.json) · [npm install](https://docs.npmjs.com/cli/install/) · [npm pack](https://docs.npmjs.com/cli/pack/)

## Comprobación prevista

- Desde un prefijo temporal, instalar la CLI y verificar `config set`, `auth status`, `operations list`, `operations describe` y `read get_project_overview`. Comprobar las tres lecturas nuevas y las 15 preparaciones con fixtures. Probar los recorridos de borrador desactualizado, exportación confirmada y configuración del feed. Acreditar el estado final con una lectura.
- En Vercel, obtener **Personal · Prueba** y comprobar la audiencia y los permisos reales. Mantener los tokens fuera de argumentos, archivos compartidos y registros. Para OAuth, añadir pruebas de renovación, revocación y rechazo de tokens de audiencia MCP o sesión web.
- Para lecturas o exportaciones que dependen de TSV, comprobar el almacenamiento de producción. Si falta un objeto, conservar `EXPORT_FILE_UNAVAILABLE` o `FEED_FILE_UNAVAILABLE` como diagnóstico del resultado. [Incidente y recuperación de Productos](../../../../../../../deploys/bitacora-construccion/07-vercel-desde-github.md#incidente-de-productos-del-2026-11-21)
