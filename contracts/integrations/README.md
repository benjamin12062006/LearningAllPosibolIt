# Integraciones MCP

Fecha de creación: 2026-11-14  
Relacionada con: [plan de acceso externo](../../docs/plans/feature/ai-assistant/07-plan-acceso-externo-y-cli.md), [bitácora](../../bitacora-construccion/feature/ai-assistant/12-acceso-mcp-desde-nest.md), [configuración del servidor local](../../../LearningAllPosibolIt-ai/README.md#servidor-mcp-local).

## Administración de un proyecto

`P` corresponde a `/api/v1/organizations/:organizationId/projects/:projectId`. Estas rutas aceptan la sesión humana de Descope en `Authorization: Bearer`.

| Ruta | Resultado |
| --- | --- |
| `GET P/integrations/credentials?limit=20&cursor=<id>` | 200 `{ items, nextCursor }`. El cursor de continuación viene de la respuesta anterior. Un miembro ve sus credenciales y un Admin u Owner puede consultar las del proyecto. |
| `POST P/integrations/credentials` | 201 `{ credential, token }` con `Cache-Control: no-store`. Requiere `Idempotency-Key`. El cuerpo acepta `label`, `audience: "mcp"`, `capabilities: ["read"]` o `["read", "prepare"]`, y `expiresAt` opcional en ISO 8601 con zona horaria. |
| `POST P/integrations/credentials/:id/revoke` | 204 por el titular o quien gestiona miembros. Se puede repetir y funciona en una organización archivada. |
| `GET P/integrations/proposals/:id` | 200 `{ proposal }` para el titular. Muestra `summary`, `target`, `hash`, `status`, `expiresAt` y `result`. |
| `POST P/integrations/proposals/:id/confirm` | 200 `{ proposal }` con el estado y resultado. Envía `{ proposalHash }` con el `hash` revisado y una sesión del titular con permiso vigente. |
| `POST P/integrations/proposals/:id/reject` | 200 `{ proposal }` con `status: "rejected"`. Usa el mismo cuerpo y la sesión del titular. |

La vigencia predeterminada es de 24 horas y admite hasta 7 días. Cada titular puede tener 10 credenciales activas por proyecto. La interfaz muestra el token en el momento de emitirlo. Si pierde esa respuesta, el reintento devuelve 409 `INTEGRATION_CREDENTIAL_ALREADY_ISSUED`. Puede encontrar la credencial por su etiqueta en el listado, revocarla y emitir otra con una clave nueva.

Una credencial de preparación exige `ai.use`. La propuesta guarda el efecto que se revisó y vence tras 30 minutos o cuando vence su credencial, lo que ocurra primero. Tras la revocación, una propuesta pendiente responde 409 `AGENT_PROPOSAL_EXPIRED` al confirmar. Repetir una confirmación que ya se guardó devuelve su resultado. Para una transformación de hoja, confirmar crea un borrador. Su aprobación y aplicación conservan el flujo habitual.

## Pasarela interna

`GET /internal/v1/mcp-integrations/session`, `GET /internal/v1/mcp-integrations/operations` y `POST /internal/v1/mcp-integrations/operations/:name` reciben `Authorization: Bearer <MCP_ADAPTER_SERVICE_TOKEN>` y `X-Ktsu-Delegation: Bearer <credencial MCP>`. El secreto de adaptador se configura en el entorno del proceso. Si Nest está detrás de un proxy público, el proxy bloquea estas rutas y descarta la cabecera de delegación entrante.

El POST recibe `{ callId, mode, arguments }`. `callId` es un UUID. `execute` se usa para lecturas y `prepare` devuelve `{ proposalId, summary, expiresAt, reviewPath }`. La pantalla revisa la propuesta con las rutas humanas de este contrato. `reviewPath` identifica la ruta de revisión en el proyecto de Nuxt y carece de credenciales. Un reintento HTTP de la misma preparación reutiliza su `callId`. Cambiar los argumentos de ese ID da 422.

## Conexión remota con OAuth

`GET P/integrations/credentials` incluye `oauthResourceUrl`. Es la URL HTTPS configurada para ese proyecto, o `null` si el entorno carece de ese recurso. La UI puede ofrecer la copia de la URL, y verifica el funcionamiento mediante una lectura desde el cliente MCP.

Para autorizar la cuenta, el POST de credenciales admite `audience: "mcp_oauth"` con los mismos campos y cabecera de idempotencia. Devuelve `{ credential }`. La persona conecta el cliente con la URL del MCP y completa la sesión y el consentimiento en Descope. Una concesión activa por persona, proyecto y Resource limita los scopes OAuth del cliente. Puede revocarse por el mismo endpoint de revocación. Un JWT emitido antes del alta requiere renovar el acceso en el cliente.

El adaptador remoto presenta al Nest privado `Authorization: Bearer <MCP_ADAPTER_SERVICE_TOKEN>` y `X-Ktsu-Mcp-OAuth: Bearer <access_token>`. Nest valida la firma, el issuer, la audiencia, el vencimiento y `ktsu:mcp:read`. Solo ofrece preparación con `ktsu:mcp:prepare`, una concesión compatible y el permiso actual de la cuenta. Los dos tipos de delegación son mutuamente excluyentes. El borde descarta ambas cabeceras privadas. [Plan de la pantalla](../../../LearningAllPosibolIt-web/docs/plans/feature/integrations/01-plan-mcp-oauth-descope.md)

Nest resuelve organización y proyecto desde la credencial, y valida los recursos seleccionados con sus servicios de dominio. El límite es de 60 peticiones por persona y proyecto y 240 en total por proyecto por minuto UTC, incluidos el descubrimiento y las llamadas. `search_knowledge` se ofrece cuando FastAPI está configurado. Admite `query` y hasta ocho resultados. Nest envía el alcance a FastAPI y vuelve a validar la credencial antes de entregar el resultado.

| Estado | Motivo |
| --- | --- |
| 401 | Credencial de adaptador o delegación ausente, inválida, vencida, revocada o de otra audiencia. |
| 403 | Capacidad o permiso insuficiente. |
| 404 | Recurso ajeno, membresía retirada u operación fuera del catálogo. |
| 409 | Organización archivada, divergencia o propuesta pendiente que ya no se puede confirmar. |
| 429 | Límite de peticiones o de propuestas pendientes. |

## CLI y skill del repositorio

- `GET P/integrations/cli-skill` devuelve `{ name, files: [{ path, content }] }` a un miembro del proyecto con sesión web. Contiene el texto versionado de la [skill de CLI](../../skills/ktsu-cli/SKILL.md).
- La CLI acepta el token opaco de audiencia `cli` o un access token de Descope con `X-Ktsu-Cli-Project: <uuid>`. `GET /api/v1/integrations/oauth` sirve el issuer, Resource, Client ID y scopes públicos. Las concesiones `cli_oauth` se emiten desde el proyecto y no devuelven un secreto.
- `GET /api/v1/integrations/proposals/:id` devuelve el estado al titular con la credencial que preparó la propuesta. Solo la web confirma o rechaza. `GET /api/v1/integrations/proposals/:id/file` sirve una exportación de hoja después de confirmarla.
- `GET /api/v1/integrations/exports/:exportId/file` y `GET /api/v1/integrations/feeds/:feedId/versions/:versionId/file` sirven TSV del proyecto autorizado. Los códigos del almacén distinguen archivos faltantes y versiones retiradas.
