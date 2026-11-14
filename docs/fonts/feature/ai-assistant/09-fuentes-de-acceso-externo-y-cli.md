# 09 — Fuentes de acceso externo y CLI

Fecha de creación: 2026-11-14  
Última actualización: 2026-11-14  
Estado: Investigación para el acceso externo posterior al chat.  
Relacionada con: [plan de acceso externo y CLI](../../../plans/feature/ai-assistant/07-plan-acceso-externo-y-cli.md), [fuentes del catálogo](07-fuentes-de-catalogo-ejecuciones-y-confirmaciones.md), [plan de eventos y contrato del chat](../../../plans/feature/ai-assistant/06-plan-eventos-cuotas-y-contrato-del-chat.md).  
Revisión de partida: Nest `7be788b`, FastAPI `d9f00fd`, más el trabajo local de E6.1b.2 y E6.2.

## Requisitos

| ID | Evidencia | Qué exige |
| --- | --- | --- |
| H1 | Petición del usuario del 2026-11-14 sobre la pantalla Integraciones, CLI y MCP. | Una persona conecta un cliente externo desde la aplicación, limita su acceso, obtiene instrucciones de configuración y puede revocarlo. El chat normal sigue funcionando con el agente de la aplicación. |
| H2 | [Diseño 15](../../../../../docs-diagrams/15-chat-ia-herramientas-y-propuestas.md), «Contexto controlado por Nest», «Herramientas» y «Límites», y [diseño 18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T02, T03 y T18b–T20. | Nest delimita empresa, proyecto, columnas, filas, operaciones y presupuestos. Los IDs ajenos quedan fuera. Las decisiones de escritura y los cambios oficiales requieren autorización humana. |
| H3 | [Diseño 16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), «Convenciones de API», y [plan E6.3a](../../../plans/feature/ai-assistant/05-plan-catalogo-ejecuciones-y-confirmaciones.md), D3–D7. | Reutilizar DTO, catálogo, servicios y alcance. El contrato humano usa Descope. El token del run es efímero y está ligado al agente interno. Una escritura propuesta espera confirmación. |
| H4 | [Plan E6.6](../../../plans/feature/ai-assistant/06-plan-eventos-cuotas-y-contrato-del-chat.md), contrato y comprobación local. | Terminar el recorrido propio con conversación, catálogo, confirmación y pruebas antes de habilitar clientes externos. Verificar el cliente externo con datos sintéticos y una matriz por transporte. |

## Código y contratos disponibles

| ID | Evidencia | Lectura para el plan |
| --- | --- | --- |
| E1 | [`DescopeSessionGuard`](../../../../src/auth/descope-session.guard.ts), [`assertProjectPermission` y `isProjectMember`](../../../../src/projects/project-access.ts), [`permissionsFor`](../../../../src/organizations/organization-roles.ts). | La sesión aporta una identidad local y cada servicio aplica permisos actuales por organización/proyecto. El guard humano puede quedar separado de un guard de credenciales delegadas. Un Manager puede operar sobre cambios, mientras `members.manage` se reserva a Admin y Owner. |
| E2 | [`createInvitationToken`](../../../../src/organizations/invitations.ts), [`createDeliveryToken`](../../../../src/feeds/delivery-token.ts), [fuentes de invitaciones](../organizations&access/02-fuentes-de-equipos-e-invitaciones.md). | Ya hay un patrón de 32 bytes aleatorios en `base64url`, un hash persistido y retorno puntual. Las invitaciones se consumen una vez. Una integración necesita autenticarse repetidamente durante su vigencia y conservar el estado de revocación. |
| E3 | [C7 y contratos](../../../../contracts/README.md), [inventario C7](../graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [plan E6.3a](../../../plans/feature/ai-assistant/05-plan-catalogo-ejecuciones-y-confirmaciones.md), «Catálogo», «Confirmación humana» y «Contratos». | Los documentos fijos de C7 ayudan a probar proyecciones. El registro futuro del catálogo aporta esquemas y handlers. El delegador puede resolver al mismo actor a partir de una credencial y dejar el acceso limitado a esa nueva frontera. |
| E4 | [`package.json`](../../../../package.json), [`run-auth-request.mts`](../../../../scripts/descope/run-auth-request.mts) y [cliente de referencia en Python](../../../../contracts/README.md). | Nest ya desarrolla en Node 24, TypeScript ESM y pnpm. `run-auth-request.mts` es un script para autenticar a un usuario de prueba con gestión Descope. Para el CLI de producto basta un cliente HTTP pequeño con el runtime de Node. El ejemplo Python prueba el contrato GraphQL actual y tiene otro propósito. |
| E5 | [Plan de H6](../../../plans/feature/ai-assistant/04-plan-herramientas-de-hoja-del-agente.md), «Vigencia y efectos de una propuesta», y [borradores actuales](../../../../src/changesets/changesets.repository.ts). | Las propuestas deben seguir la selección y revisión materializadas. La confirmación crea el efecto autorizado, que para una hoja es un borrador. La aprobación y aplicación posterior siguen las transiciones del dominio. |
| E6 | [Plan E6](../../../plans/feature/ai-assistant/01-plan-e6-ia-con-qdrant-y-llamaindex.md), D4–D6, [API de conocimiento de FastAPI](../../../../../LearningAllPosibolIt-ai/src/ktsu_ai/http/knowledge_http/routes.py) y aclaración del usuario del 2026-11-14. | El servidor MCP se aloja dentro de FastAPI. Puede ejecutar localmente conocimiento con LlamaIndex y Qdrant tras validar el alcance con Nest. Nest conserva la autoridad sobre permisos, datos de producto y cambios. Si el CLI ofrece conocimiento, lo solicita por Nest. |

## Cursos y documentación técnica

Consulta del 2026-11-14.

| ID | Evidencia primaria o reconstrucción | Aplicación |
| --- | --- | --- |
| C1 | [NestJS GraphQL, Fernando Herrera, sección 6, lección 75](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 6 Autenticación y autorización/75. JwtAuthGuard.md>), líneas 23–31, «sobre escritura del get request». | El guard toma la petición en el transporte antes de llegar al resolver. El mecanismo se reutiliza como patrón de frontera. El token delegado opaco, su alcance y su revocación son decisiones de este proyecto. |
| C2 | [NestJS GraphQL, sección 6, lección 77](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 6 Autenticación y autorización/77. Custom Decorator - CurrentUser.md>), líneas 19–29, «eso se va a ver como request user». | El receptor usa la identidad que el guard puso en la petición. En la nueva frontera la identidad técnica está tipada y conserva referencia a la persona delegante. |
| RC1 | [Reconstrucciones R9 y R10 verificadas](../../db/04-curso-nest-graphql-reconstrucciones.md) el 2026-10-30. | Se reutilizan para el patrón de guard y decorador. La adaptación deja intacto el login Descope y restringe las credenciales nuevas a sus propias rutas. |
| F1 | [RFC 6750, secciones 2.1 y 5.3](https://www.rfc-editor.org/rfc/rfc6750.html#section-2.1). | Uso de la cabecera Bearer, TLS, caducidad y audiencia. Es referencia del transporte del secreto opaco local. |
| F2 | [Node 24, `util.parseArgs`](https://nodejs.org/download/release/v24.22.1/docs/api/util.html#utilparseargsconfig) y [Node 24, `randomBytes`, `createHash`, `timingSafeEqual`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandombytessize-callback). | Parser de argumentos y primitivas criptográficas disponibles en la versión objetivo. Validar longitudes antes de una comparación de hashes en tiempo constante. |
| F3 | [OpenAI, conectar y probar un servidor MCP](https://developers.openai.com/plugins/deploy/connect-chatgpt#prepare-the-endpoint) y [OpenAI, autenticación de plugins](https://developers.openai.com/plugins/build/auth#custom-auth-with-oauth-21). | Para el cliente alojado, verificar HTTPS con Streamable HTTP o Secure MCP Tunnel, además de OAuth 2.1 conformante con MCP para datos del usuario. La prueba de un transporte local por `stdio` acredita únicamente ese cliente y entorno. La guía especifica que ChatGPT no presenta claves API personalizadas. |

## Necesidad, evidencia y decisión

| Necesidad | Evidencia | Decisión del plan 07 |
| --- | --- | --- |
| Emitir y revocar credenciales desde Integraciones | H1–H3, E1–E2, C1–C2/RC1 y F1–F2 | D1–D3. Sesión Descope para administrar, secreto mostrado en la emisión y permiso efectivo calculado por Nest en cada operación. |
| Mantener un solo contrato de operaciones | H2–H4, E3 y E5–E6 | D4–D5. CLI y MCP comparten catálogo de producto acotado. FastAPI conserva el acceso a conocimiento con ámbito validado. Una escritura preparada se confirma con sesión humana. |
| Dar una instalación local usable | H1, E4, F2 | D6–D7. CLI en TypeScript con `parseArgs`, perfiles de URL/Nest y plantillas de configuración sin secretos. |
| Identificar compatibilidad MCP sin prometerla | H1 y F3 | D8. Separar integración por `stdio`, conexión remota, OAuth y comprobación por cliente. |
