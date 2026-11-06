# 03 — Mapa de necesidades y fuentes para el plan de E2

Fecha de creación: 2026-11-05  
Estado: Investigación cerrada; decisiones en el [plan 01](../../../plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md).  
Tipo de fuente: elaboración propia a partir de las fichas 01–02.  
Relacionada con: [estado real 01](01-estado-real-y-antecedentes.md), [fuentes 02](02-fuentes-tecnicas-y-cursos.md).

Formato: **Necesidad → requisito → fuentes → decisión pendiente**. Los `H` y `E` remiten a la ficha 01; los `C` y `F`, a la 02.

| # | Necesidad | Requisito | Fuentes | Decisión que debe tomar el plan |
| --- | --- | --- | --- | --- |
| N1 | Transporte de la cola | Ejecución durable (H1) | H2, H8, E4, E5, F1, F6 | ¿BullMQ/Redis, como propone 17, o la cola en PostgreSQL que ya usa feeds? Si es PostgreSQL, ¿qué deja preparado para cambiar más adelante? |
| N2 | Un solo bucle de worker | Mantenimiento | E1 | ¿Clase común compuesta por cada worker o herencia? ¿Qué parte del ciclo de vida (arranque, `wake`, apagado) va en ella? |
| N3 | Importación sin `interruptRunning` | H4, «migración del consumidor anterior» | E2, E3, E4, F3, C6 | Columnas de lease y token; qué fallos se reintentan; cómo empieza de cero un reintento (filas parciales); el estado público durante la espera; qué pasa con las filas `running` de antes del despliegue. |
| N4 | Evaluación sin `interruptRunning` | Ídem | Ídem | Lo mismo para las evaluaciones y sus filas parciales; qué ve la actualización del feed que espera (E11). |
| N5 | Renovar el lease | «Worker pierde lease» (H3) | E4, F3 | Feeds no renueva (lease de 5 min). ¿Una importación o evaluación de 5.000 filas lo necesita? ¿Se renueva con cada lote? |
| N6 | Outbox | H1, H3 | C1–C4, F2, E6 | Tabla y estados; relay por sondeo con lease; cómo es idempotente el consumidor; ¿cuál es el primer consumidor real, sin crear una tabla vacía para el futuro (17, «no crear tablas anticipadas»)? |
| N7 | Registro de archivos | H5 | E6–E8 | ¿Tabla central de artefactos o las tablas de dominio que ya guardan clave, tamaño y checksum? ¿Cómo se garantiza el borrado tras el commit? |
| N8 | Recibos | H6, E4 de 18 | C5, C7, F4, F5, E9 | Tabla, ámbito y clave; huella del cuerpo; códigos 400/409/422; qué respuestas se guardan; caducidad; qué rutas lo usan ya; cómo se hará dentro de la transacción en E4. |
| N9 | Observabilidad | H5 | E10, F7 | `requestId` en todas las peticiones; ruta de salud; registros de las transiciones de los trabajos; aviso de cola atascada. ¿Métricas tipo Prometheus ahora o cuando haya dónde verlas? |
| N10 | Pruebas de fallos | H7 (T30, T31) | F2, F3 | Qué se demuestra en PGlite (secuencial) y qué queda sin verificar (procesos reales en paralelo). |
