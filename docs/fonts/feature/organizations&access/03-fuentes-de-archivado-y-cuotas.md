# 03 — Fuentes para archivar organizaciones y cuotas mínimas (E1.4)

Fecha de creación: 2026-11-03  
Estado: Investigación que respalda el [plan 03](../../../plans/feature/organizations&access/03-plan-e1.4-archivado-y-cuotas.md).  
Relacionada con: [ficha 02](02-fuentes-de-equipos-e-invitaciones.md) (F36), [ficha 01](01-fuentes-de-acceso-y-organizaciones.md), [secuencia de la ampliación](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), [plan GraphQL aplazado](../../../plans/feature/graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md).

## Requisitos del proyecto

| ID | Documento y pasaje | Qué exige |
| --- | --- | --- |
| R1 | [18](../../../../../docs-diagrams/18-secuencia-de-entregas-y-matriz-de-aceptacion.md), fila E1 | E1 incluye «acceso de recursos y archivado; cuotas mínimas». |
| R2 | [12](../../../../../docs-diagrams/12-hojas-modelo-editor-importacion-y-exportacion.md), «Crear/renombrar/duplicar/archivar» | «Archivar impide escrituras y permite lectura según retención». |
| R3 | [17](../../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md), SaaS | Modo solo lectura según política; «no borrar datos automáticamente». |
| R4 | [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), tabla de permisos | «Transferir propiedad, cerrar empresa, facturación»: solo `owner`. |
| R5 | [19](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md), P07 | Las cuotas definitivas se fijan antes del piloto. Las de E1.4 son límites iniciales, no compromisos comerciales. |
| R6 | [Plan GraphQL aplazado](../../../plans/feature/graphql&rulesets-evaluations-exports/01-plan-aplazado-sincronizacion-graphql.md), «Decisión» | El usuario decidió que las features nuevas se construyen solo en REST; GraphQL se sincroniza al final del backend. |

## Curso

Curso: **Learn the REST API Concepts, Design best practices, Security practices, Swagger 2.0/OAI, Hands on API Management** (carpeta `Arquitectura/Diseño y Seguridad de APIs REST`), sección 11 «API Management». Instructor no consta en el archivo. Ruta relativa a la biblioteca `/Users/benji/Documents/chrome-extencions/trancripciones/`: `Arquitectura/Diseño y Seguridad de APIs REST/Sección 11 API Management/`. Consulta: 2026-11-03. Sin código que reconstruir.

| ID | Lección y localizador | Evidencia | Uso |
| --- | --- | --- | --- |
| C11 | `57. API Traffic Management.md`, líneas 15–19; búsqueda «protecting the back end» | Un consumidor que se comporta mal degrada a los demás; el proveedor limita para proteger el backend y la experiencia del resto. | Principio: cada empresa tiene un tope de recursos para no agotar los compartidos. |
| C12 | `57. API Traffic Management.md`, líneas 21–23; búsqueda «how do we enforce it» | Un límite de contrato solo sirve si el servidor lo hace cumplir. | Las cuotas se comprueban en la transacción que crea el recurso, no en el cliente. |

El curso trata límites de peticiones (tráfico); aquí son límites de cantidad de recursos. Se toma el principio, no el mecanismo.

## Documentación oficial

Consulta: 2026-11-03.

| ID | Fuente y sección | Evidencia | Uso |
| --- | --- | --- | --- |
| F38 | [OWASP API Security Top 10 2023 — API4 Unrestricted Resource Consumption](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption), «Is the API Vulnerable?» y «How To Prevent» | «An API is vulnerable if at least one of the following limits is missing or set inappropriately»; recomienda «Limit/throttle how many times or how often a single API client/user can execute a single operation». | Tope de organizaciones de equipo por persona y de plazas por organización. |
| F39 | [PostgreSQL 17 — 13.3.2 Row-Level Locks](https://www.postgresql.org/docs/17/explicit-locking.html) | «FOR UPDATE causes the rows retrieved by the SELECT statement to be locked as though for update. This prevents them from being locked, modified or deleted by other transactions until the current transaction ends.» | Toda escritura de membresías bloquea antes la fila de la organización: archivar, invitar y aceptar se ordenan, y contar plazas no tiene carreras. Crear un equipo bloquea la fila del usuario para contar sus equipos. |
| F36 | Ya registrada en la [ficha 02](02-fuentes-de-equipos-e-invitaciones.md) | Re-evaluación del `WHERE` en Read Committed. | Sigue protegiendo al último owner. |

## Límites

Los números (10 equipos por persona, 50 plazas por organización) son propuesta propia para el piloto: ninguna fuente los fija (R5).
