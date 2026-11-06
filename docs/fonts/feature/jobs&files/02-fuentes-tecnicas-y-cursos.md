# 02 — Fuentes técnicas y cursos para E2 (ejecución y archivos)

Fecha de creación: 2026-11-05  
Tipo de fuente: cursos locales (transcripciones originales), documentación oficial y artículos de referencia.  
Fecha de consulta: 2026-11-05  
Relacionada con: [estado real 01](01-estado-real-y-antecedentes.md), [mapa 03](03-mapa-de-necesidades-para-el-plan.md), [fuentes técnicas de feeds](../feeds&publications/02-fuentes-tecnicas.md) (lease, reloj y reintentos, que aquí no se repiten).

La biblioteca de cursos está en `/Users/benji/Documents/chrome-extencions/trancripciones/`. Las rutas son relativas a esa carpeta. Búsquedas hechas con `buscar-aprendizaje-en-cursos` («outbox pattern transactional», «idempotency key», «bullmq queue retry», «distributed lock lease», «event driven at least once duplicate messages») y con `grep` de `outbox`, `idempoten` y `skip locked` sobre los originales, sin las reconstrucciones.

## Cursos

| Id | Lección | Pasaje (línea) | Qué respalda |
| --- | --- | --- | --- |
| C1 | *Spring Cloud y Microservicios*, Sección 10 «Resiliencia de Datos y Alto Rendimiento», `Java/Spring Cloud y Microservicios/Sección 10 Resiliencia de Datos y Alto Rendimiento/151. El problema de la dependencia de disponibilidad.md` | L13–L17 (búsqueda: «dependencia de disponibilidad») | El problema: una transacción que llama a un sistema externo se bloquea si ese sistema no responde. |
| C2 | Ídem, `152. Outbox persistencia atómica 1.md` | L13: «Vamos a ver el patrón Transactional Outbox, vamos a aprender cómo eliminar ese acoplamiento con sistemas externos»; L15, analogía de la bandeja de salida del correo | Guardar el mensaje en la misma transacción que el negocio. |
| C3 | Ídem, `154. Message relayer El cartero de mensajes.md` | L13: el relay es «una especie de cartero, que cada 10 segundos revisa nuestra bandeja de salidas»; «Si encuentra un mensaje pendiente va a intentar enviarlo» | Relay por sondeo con tarea programada; estados pendiente/procesado. |
| C4 | Ídem, `155. Transactional Outbox y Coreografía extrema.md` | L13–L19 | El relay sigue entregando cuando el sistema externo vuelve, sin perder la venta. |
| C5 | *DynamoDB - Modelado de Datos*, Sección 18 «ACID Transactions», `AWS/DynamoDB - Modelado de Datos/Sección 18 ACID Transactions/59. TransactWriteItems Idempotence.md` | L19: el servicio «checks if the transaction with client token … has already been processed»; L21: el token vale 10 minutos y reutilizarlo con otra operación lanza «parameter mismatch exception» | Recibo con clave del cliente, caducidad y error si la misma clave llega con otro contenido. |
| C6 | *Building, scaling and deploying distributed systems in Golang and Kubernetes*, Sección 14 «Reliability», `Go/…/Sección 14 Reliability/86. Understanding DLQ and Retries.md` | L27: «Retry until we reach a timeout or a retry amount»; L29: «exponential backoff»; L25: sin cola de fallos, «failed messages just disappear forever» | Reintentos con espera exponencial y máximo; el fallo definitivo se conserva para revisarlo. |
| C7 | *NestJS API Profesional*, Sección 3, `NestJS/NestJS API Profesional/Sección 3 Building a Production-Grade REST API/13. A Quick Refresher Core REST API Concepts.md` | L17: una petición es idempotente si sus efectos en el servidor «are exactly the same as when we made the first request»; L19: `POST` no lo es, porque crea un recurso cada vez | Qué rutas necesitan recibo: los `POST` que crean. |
| C8 | *DDD y Microservicios*, Sección 14 «Managing Distributed Transactions with SAGA», `Arquitectura/DDD y Microservicios/Sección 14 …/103. SAGA Implementation Considerations.md` | L15: definición de idempotencia | Los consumidores de mensajes deben ser idempotentes. |

No se encontró en la biblioteca ningún curso con BullMQ, `SKIP LOCKED`, fencing tokens ni `Idempotency-Key` como cabecera HTTP: esas partes se apoyan en la documentación oficial.

## Documentación oficial y referencias

| Id | Fuente | Qué dice |
| --- | --- | --- |
| F1 | [PostgreSQL — SELECT, The Locking Clause](https://www.postgresql.org/docs/current/sql-select.html) | `SKIP LOCKED`: las filas que no se pueden bloquear al momento se saltan; «not suitable for general purpose work, but can be used to avoid lock contention with multiple consumers accessing a queue-like table». `FOR UPDATE OF` bloquea solo las filas de la tabla nombrada. |
| F2 | [microservices.io — Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) | El mensaje se guarda en la misma transacción que el negocio y solo sale si esta confirma. El relay puede publicar dos veces (cae tras publicar y antes de marcar), así que el consumidor debe ser idempotente, por ejemplo guardando los ids ya procesados. Relay por sondeo (*polling publisher*) o leyendo el log de transacciones. |
| F3 | [Martin Kleppmann — How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) | Un lease solo no basta: un proceso pausado puede despertar con el lease vencido y escribir. El almacén debe rechazar la escritura de un token antiguo (*fencing token*). |
| F4 | [IETF — The Idempotency-Key HTTP Header Field](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/), draft-08 (2026-10-22) | Cabecera `Idempotency-Key` de tipo *String* de Structured Fields; se recomiendan UUID. Huella del cuerpo opcional. Errores: falta la clave cuando es obligatoria → **400**; misma clave con otro cuerpo → **422**; misma clave aún en curso → **409**. El recurso debe publicar su política de caducidad. |
| F5 | [Stripe — Idempotent requests](https://docs.stripe.com/api/idempotent_requests) | Guarda el código y el cuerpo de la primera respuesta y los repite, «including `500` errors»; claves de hasta 255 caracteres; se pueden borrar a las 24 h; compara los parámetros y da error si difieren; no guarda nada si la validación falla o si hay otra petición concurrente con la misma clave; solo `POST`. |
| F6 | [NestJS — Queues](https://docs.nestjs.com/techniques/queues) y [BullMQ — Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs) (F3 de [19](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md)) | La integración de Nest con BullMQ necesita Redis; la idempotencia hay que diseñarla en los efectos del trabajo, no la da la cola. |
| F7 | [NestJS — Lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events) (ya en uso: `enableShutdownHooks` en `main.ts`) | `onModuleDestroy` y `onApplicationShutdown` se ejecutan al recibir la señal de apagado. Es el momento de soltar los leases. |

## Interpretación

- **Outbox y relay (C2–C4, F2):** el curso usa RabbitMQ como transporte. Aquí no hay transporte externo: el «envío» es el efecto mismo (borrar un archivo y, en E4, lo que se encadene a una revisión). La idea transferible es la fila en la misma transacción, el relay por sondeo y un consumidor idempotente. RabbitMQ y el `@Scheduled` de Spring no se transfieren.
- **Recibos (C5, F4, F5):** los tres coinciden en la clave del cliente, la comparación del contenido y la caducidad. Difieren en detalles: DynamoDB da 10 minutos y Stripe 24 h; Stripe repite incluso un 500, mientras que la IETF solo pide una respuesta «consistente». El plan tiene que elegir.
- **Fencing (F3):** feeds ya lo aplica con un token aleatorio comprobado en el `WHERE`. El token no es creciente, pero cumple el mismo papel: solo el reclamo vigente puede escribir.
