# 03 — Plan de conversaciones privadas y mensajes idempotentes

Fecha de creación: 2026-11-14  
Última actualización: 2026-11-14  
Estado: En curso.  
Ámbito: Nest, E6.2 del Bloque C.  
Relacionada con: [plan maestro de cierre](../cierre-backend/02-plan-terminar-hojas-visor-y-agente.md), [plan E6](01-plan-e6-ia-con-qdrant-y-llamaindex.md), [fuentes 05](../../../fonts/feature/ai-assistant/05-fuentes-de-conversaciones-y-mensajes.md), [bitácora 08](../../../../bitacora-construccion/feature/ai-assistant/08-conversaciones-y-mensajes.md).  
Revisión de partida: Nest `7be788b`.

## Objetivo

Crear una conversación de un libro o una hoja, volver a encontrarla con la sesión del autor y guardar mensajes sin duplicarlos al reintentar. La base de conversaciones permitirá iniciar los runs en E6.3a.

## Decisiones

| ID | Implementación prevista | Evidencia |
| --- | --- | --- |
| D1 | Crear `ConversationsModule` con DTOs, controlador, servicio y repositorio. `Conversation` tendrá ámbito de organización/proyecto/libro; la hoja será opcional para un chat de creación de hoja. Identidad y pertenencia se derivan de sesión y datos de la API. | H1, H3, E3 y C1/RC1. |
| D2 | El creador conserva lectura del historial mientras siga en la organización aunque pase a Viewer o el recurso se archive. La escritura requiere `ai.use` y organización, libro y hoja activos. Para conversaciones ajenas responder 404 antes de dar detalles de archivado o permiso. | H1, H4 y E1–E2. |
| D3 | Dentro de una transacción y bajo el bloqueo de la organización, comprobar ámbito/autor, permiso y estado, buscar el mensaje por clave, comparar su texto normalizado y asignar la siguiente secuencia si es nuevo. El reintento autorizado con el mismo contenido devuelve el mismo registro. Con otro contenido devuelve `IDEMPOTENCY_KEY_REUSED` (409). El mensaje se guarda por sí solo. | H2–H3, E2 y C3/RC2. |
| D4 | Guardar título y mensaje como texto plano. Propongo máximo de 200 caracteres para título, como en borradores, y 16.000 para mensaje, como en FastAPI. Validar cadenas no vacías y caracteres de control, conservar saltos de línea y tabulaciones válidas en el mensaje y normalizar CRLF a LF. Recibir `clientMessageId` UUID. Nest fija `role: user` y `authorId`. | H1, E4–E5 y C3/RC2. |
| D5 | Usar páginas acotadas con cursor, 20 por defecto y máximo 100. Mantener el modelo de autorización, servicio y validación de REST cuando se expongan consultas y mutaciones GraphQL. Validar ambos contratos desde las pruebas. | H2, H4, E5. |

**Ajuste de D3.** `IDEMPOTENCY_KEY_REUSED` conserva el HTTP 422 definido por la API. Los reintentos con el mismo texto normalizado devuelven el mensaje original con 201 y conservan `updatedAt`.

## Contrato previsto

`P` es `/api/v1/organizations/:organizationId/projects/:projectId`. Todas las rutas usan la sesión de Descope.

| REST | Entrada y resultado | Equivalente propuesto para Nuxt |
| --- | --- | --- |
| `POST P/workbooks/:workbookId/conversations` | `{ title }` → 201 `{ conversation }`, con `worksheetId: null`. | `createWorkbookConversation` |
| `POST P/worksheets/:worksheetId/conversations` | `{ title }` → 201 `{ conversation }`, con el libro resuelto en Nest. | `createWorksheetConversation` |
| `GET P/conversations` | Filtro opcional `workbookId` o `worksheetId`, `limit` y `cursor` → 200 `{ items, nextCursor }`. | `Project.conversations` |
| `GET P/conversations/:conversationId` | 200 `{ conversation }`. | `conversation` |
| `POST P/conversations/:conversationId/messages` | `{ clientMessageId, content }` → 201 `{ message }` en creación y repetición autorizada. | `appendConversationMessage` |
| `GET P/conversations/:conversationId/messages` | `limit` y `cursor` → 200 `{ items, nextCursor }`. | `Conversation.messages` |

Listar conversaciones por `createdAt DESC, id DESC`, con cursor ligado a la persona, al proyecto y a los filtros. Entregar primero los mensajes más recientes en una página en orden cronológico. El cursor del historial señala la secuencia anterior a la página y pertenece a esa conversación. En ambos casos, pedir una fila adicional para decidir si existe siguiente página. Un cursor inválido o de otra consulta se rechaza con 400 tras autorizar el ámbito correspondiente. El listado responde vacío si el ámbito es visible y la persona carece de conversaciones propias.

GraphQL entra en E6.2 si basta con tipos, validadores y resolvers del patrón C7 que deleguen en el mismo servicio. Las seis rutas se añaden a la matriz en cualquier caso. Con seis equivalentes, el recuento previsto es 91 de 115, 10 solo HTTP y 14 en REST. Si se difiere GraphQL por un coste concreto de contrato, se registra el ajuste y el recuento pasa a 85 de 115, 10 solo HTTP y 20 en REST. El catálogo del agente queda sin acceso a estas operaciones.

**Ajuste al diseño 15.** El diseño une el POST del mensaje y el run. En E6.2, 201 significa que el mensaje ya existe en PostgreSQL; E6.3a usará su ID autorizado para disparar la ejecución mediante `POST P/conversations/:conversationId/runs` con 202. El historial enviado a FastAPI lo arma Nest a partir de mensajes anteriores al disparador y aplica los límites del servicio de IA.

## Incrementos

1. **Persistencia local.** En Prisma y SQL, aplicar FK compuesta desde la conversación a libro `(organizationId, projectId, workbookId)` y, si hay hoja, a `(workbookId, worksheetId)`. Aplicar FK al autor y mensaje a conversación, secuencia positiva única por conversación y unicidad de `(conversationId, authorId, clientMessageId)`. Añadir valores iniciales de visibilidad privada y estado activo. Mantener índices para el listado y el historial y actualizar la lista de migraciones esperadas.
2. **Conversaciones privadas.** Implementar altas, listado y detalle con alcance de organización/proyecto, autor y filtro de libro/hoja. Resolver el perfil local con `UsersService.findCurrent`. Reusar el bloqueo de organización existente para serializar escritura con archivado, cambio de rol o revocación.
3. **Mensajes.** Implementar envío y lectura paginada. Aplicar ámbitos antes de efectos y mantener orden e idempotencia ante peticiones concurrentes. Confirmar que una repetición conserva ID, secuencia y fecha sin avanzar el contador.
4. **Contrato y cierre.** Montar las rutas en `AppModule`, actualizar la matriz C7 y comprobar paridad de entradas y errores en GraphQL si se incorpora. Registrar ajustes, defectos detectados y resultados reales en la bitácora 08.

## Comprobación prevista

| Área | Evidencia de aceptación |
| --- | --- |
| DTO y cursor | Validar blancos, límites, `clientMessageId` malformado, caracteres de control, campos extra, respuestas de cursor inválido y cursores trasladados de ámbito. |
| Persistencia y concurrencia | Migrar en local. Probar restricciones directamente con SQL para cruces de libro/hoja y secuencias o claves repetidas. Dos peticiones concurrentes con la misma clave tienen una sola fila; dos claves distintas tienen secuencias distintas y ordenables. |
| API HTTP | Sesión ausente 401. Editor y Manager escriben. Viewer recibe 403 en sus escrituras. Otra persona de la misma organización o de una distinta recibe 404 en detalle, historial y envío a conversación privada. Probar retirada de membresía, degradación a Viewer, índices de la página y organización/libro/hoja archivados. |
| Paridad GraphQL | Si se incorpora, comparar datos, paginación, ausencia de sesión, 404, 403, 409 e idempotencia con los servicios REST. Actualizar esquema esperado y prueba C7. |
| Defectos deliberados | En una copia temporal, quitar el filtro del autor, omitir el ámbito de organización/proyecto o el permiso `ai.use`, permitir archivados, omitir la comparación del reintento, compartir secuencia y saltar la FK de libro/hoja. Cada variante compilable debe fallar en la comprobación correspondiente. |
| Cierre | Compilar, lint, formato, suites completas, `pnpm db:verify`, diff vacío de esquema contra migraciones y arranque real de Nest contra PGlite temporal. Para validar contención de filas con PostgreSQL multiconexión, usar el contenedor local de pruebas del proyecto. |

Crear la migración con `pnpm db:migration:create --name create_conversations` en un PostgreSQL de desarrollo aislado con shadow DB. Aplicar y verificar también sobre PGlite. Si el contenedor local no está disponible, usar el diff entre esquemas Prisma y agregar los `CHECK` explícitos antes de probar en PGlite. La migración de Cloud SQL la aplica el usuario.

El intercambio explícito de conversaciones con revisores, los adjuntos, el uso del modelo y los eventos se retoman en sus etapas de producto. El servicio de E6.2 guarda y entrega texto plano. La presentación segura de salida Markdown del asistente se define con el contrato Nuxt.
