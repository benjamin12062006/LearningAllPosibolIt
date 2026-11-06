# 01 — Fuentes para borradores, revisión, aplicación y reversión de hojas (E4, con los recibos de E2)

Fecha de creación: 2026-11-05  
Estado: Investigación que respalda el [plan 01](../../../plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md).  
Relacionada con: [revisiones](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), [contratos](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), [trabajos](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md), [secuencia](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), [fuentes de hojas](../worksheets/02-fuentes-de-filas-por-revision.md), [fuentes de organizaciones](../organizations&access/03-fuentes-de-archivado-y-cuotas.md).

## Requisitos de la ampliación

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| G1 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), fila E4 y microentregas | Depende de E3 y de los «recibos de E2». E4.1 operaciones con versión esperada; E4.2 guardar/recargar; E4.3 diff/validación; E4.4 submit/decisión; E4.5 apply transaccional; E4.6 conflicto y revert. Salida: «Dos editores no pierden cambios y apply es atómico/idempotente por HTTP». |
| G2 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), T06–T12 | T07 dos pestañas con la misma `draftVersion`: una gana, la otra 412. T08 comparación B/H/P. T09 head cambia tras aprobar: no aplica ni pierde el diff. T10 doble click y dos keys: una revisión. T11 fallo a mitad: rollback total. T12 editar invalida decisiones; restaurar crea revisión nueva. |
| G3 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), «Guardar, validar, aprobar, aplicar» y diagrama de estados | Estados `draft → pending_review → approved → applied`, con `rejected`, `conflicted` y `cancelled`; enviar congela el contenido; aprobar fija hash, head y política; aplicar revalida todo en la transacción. |
| G4 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), «Comparación de tres versiones» | Tabla de casos B/H/P; delete frente a edición, mismo ID insertado y cambios de esquema son conflictos estructurales. «Tras aprobar, cualquier cambio de head impide aplicar»; sin auto-merge dentro de apply. |
| G5 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), «Algoritmo de aplicación atómica» | Pasos 1–7: transacción acotada, bloqueos en orden, recibo por key, revalidar permisos y head, cerrar y abrir intervalos de filas, revisión nueva y audit/recibo en la misma transacción. |
| G6 | [13](../../../../../docs-diagrams/13-revisiones-aprobaciones-y-conflictos.md), «Historial, restauración y retención» | Restaurar = nuevo borrador inverso que pasa por revisión; nunca mueve el head hacia atrás. |
| G7 | [16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md), tabla de rutas y párrafo de `Idempotency-Key` | Rutas `P/changesets…`; para guardar, ETag/If-Match: sin cabecera 428, versión distinta 412; apply con `Idempotency-Key` en el ámbito organización + actor + recurso + operación. |
| G8 | [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), «Modelo de acceso» | Crear borrador: `worksheet.write`; aprobar y aplicar: `changeset.approve`. Por defecto no hay autoaprobación en equipos; la empresa unipersonal la permite con política visible y auditoría. |
| G9 | [17](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md), E2 | Outbox, recibos y BullMQ/Redis. Para E4 solo hacen falta los recibos (G1); el resto de E2 no tiene consumidor todavía. |

## Cursos

Consulta: 2026-11-05. Rutas relativas a la biblioteca `/Users/benji/Documents/chrome-extencions/trancripciones/`. Sin reconstrucción.

| ID | Curso, lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C21 | **Aprende a trabajar versionando tu código de una forma segura y en equipo**, `Git/Git y GitHub/Sección 4 Ramas, uniones, conflictos y tags/33. Merge Uniones con conflictos.md`, líneas 13–15; búsqueda «no es capaz de unir de manera automática» | Git solo marca conflicto cuando las dos ramas cambiaron la misma línea; entonces no adivina y deja que la persona resuelva. | Comparación de tres versiones por celda (G4): solo hay conflicto si base, actual y propuesta difieren entre sí; la resolución es explícita (rebase con elección por celda). |
| C22 | **Learn how to build Microservices applications starting with business analysis and domain driven design**, `Arquitectura/DDD y Microservicios/Sección 8 Events Driven Architecture & Domain Events/53. Domain Events - Pattern.md`, líneas 37–39; búsqueda «must be done in a unit of work» | «State updates and raising of the event must be done in a unit of work or in a transaction.» | El evento de auditoría y el recibo se escriben en la misma transacción que la revisión (G5). |
| C14 | Ya registrada en [fuentes de hojas 01](../worksheets/01-fuentes-de-la-hoja-vacia.md) | El agregado se guarda de forma atómica. | Aplicar un borrador es una sola unidad de trabajo. |

## Estándares HTTP

Consulta: 2026-11-05.

| ID | Fuente | Evidencia | Uso |
| --- | --- | --- | --- |
| F45 | [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html), 13.1.1 If-Match y 15.5.13 412 | `If-Match` sirve «to prevent accidental overwrites when multiple user agents might be acting in parallel on the same resource (i.e., to prevent the "lost update" problem)». 412: «one or more conditions given in the request header fields» evaluaron a falso. | Guardar operaciones exige `If-Match` con la `draftVersion`; otra versión → 412 (T07). |
| F46 | [RFC 6585](https://www.rfc-editor.org/rfc/rfc6585.html), sección 3 | «The 428 status code indicates that the origin server requires the request to be conditional», para evitar el «lost update». | Guardar sin `If-Match` → 428. |
| F47 | [IETF draft-ietf-httpapi-idempotency-key-header-08](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) (22-10-2026, borrador, no RFC) | La cabecera hace tolerantes a fallos métodos como POST; sin clave donde se exige → 400; misma clave con otro cuerpo → 422; reintento mientras se procesa → 409. | Aplicar exige `Idempotency-Key`. Sin clave → 400; otro cuerpo → 422 (se sigue el borrador y no el 409 que proponía [16](../../../../../docs-diagrams/16-nuxt-tabla-central-chat-y-contratos.md)). Un reintento concurrente espera al bloqueo del borrador y devuelve el recibo, así que no hace falta el 409. |
| F34, F36, F39 | Ya registradas (Prisma v7, Read Committed, `FOR UPDATE`) | Transacción interactiva que revierte todo ante un error; bloqueos de fila. | Orden de bloqueo: organización → borrador → hoja (G5). |

## Límites

Ninguna fuente fija la forma JSON de las operaciones, los nombres de los estados intermedios ni la política de autoaprobación concreta: son propuesta sobre G3–G8.
