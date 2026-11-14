# 03 — Contenedor, Google Cloud y antecedentes de cursos

Fecha de creación: 2026-11-13  
Tipo de fuente: documentación oficial, transcripción conceptual y documentación del proyecto  
Fecha de consulta: 2026-11-13  
Relacionada con: [SDK y destino alojado](01-sdk-oficial-y-cobertura.md), [captura de datos](02-datos-coste-y-operacion.md).

## Evidencia

| Fuente y sección | Evidencia aplicable |
| --- | --- |
| [F12 · Cloud Run, Logging and viewing logs](https://docs.cloud.google.com/run/docs/logging) y [gcloud run services logs read](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/logs/read) | Cloud Run recoge logs del contenedor, de la plataforma y de entrada HTTP. La consola permite consultar un servicio o un Worker Pool, y Logs Explorer permite filtrar por recurso. La CLI permite leer los logs del servicio. |
| [F13 · Cloud Run, Container runtime contract](https://docs.cloud.google.com/run/docs/container-contract) y [Configure health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks) | El contenedor HTTP escucha en `0.0.0.0:$PORT`. El contrato define el apagado con `SIGTERM` y su ventana de gracia. Startup, readiness y liveness tienen propósitos distintos. |
| [F14 · Cloud Run, Configure secrets for services](https://docs.cloud.google.com/run/docs/configuring/services/secrets) y [GKE, Secret Manager add-on](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/secret-manager) | Cloud Run inyecta referencias de Secret Manager por la identidad de ejecución. Google recomienda fijar versión cuando se inyecta por variable. GKE admite el acceso desde el workload y el montaje con su complemento. Para un montaje se necesita una lectura explícita si la aplicación espera variables. |
| [F15 · Cloud Run, Billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings) | La facturación por solicitud condiciona la disponibilidad de CPU entre peticiones. Comprobar el batching y la señal de los temporizadores en staging. El proceso continuo de colas tiene su propio ciclo de vida en el plan de despliegue. |
| [F16 · Plan de despliegue de KTSU](../../../../deploys/docs/plans/01-plan-despliegue-en-google-cloud.md) y [plan de workers](../../../../deploys/docs/plans/03-datos-workers-y-recuperacion.md) | La arquitectura propuesta prevé Cloud Run para los servicios HTTP, Cloud Run Worker Pool para el consumidor continuo con posible alternativa GKE, y GKE para Qdrant. Observe se integra en cada proceso Nest que se quiera instrumentar. |
| [F17 · Operación y recuperación](../../../../docs-diagrams/17-trabajos-integraciones-operacion-y-expansion.md) y [bitácora E6](../../../bitacora-construccion/feature/jobs&files/05-observabilidad.md) | El diseño existente prioriza salud, latencia, colas y correlación por petición y trabajo. La bitácora registra la base de observabilidad ya probada en local. |
| [F19 · Cloud Monitoring, Create public uptime checks](https://docs.cloud.google.com/monitoring/uptime-checks) | Los sondeos periódicos pueden probar una URL y alertar si deja de cumplir el criterio HTTP. Para endpoints privados, Google documenta sondeos privados. |

## Consulta de cursos

**F18.** [159. OpenTelemetry y la observabilidad moderna](</Users/benji/Documents/chrome-extencions/trancripciones/Java/Spring Cloud y Microservicios/Sección 11 Observabilidad Total en Microservicios con LGTM Stack y OpenTelemetry/159. OpenTelemetry y la observabilidad moderna.md>), líneas 13–17, sección 11 del curso *Spring Cloud, Docker, Kubernetes, OAuth2, RabbitMQ, Resilience4j, API Gateway y Observabilidad con OpenTelemetry/LGTM*. El nombre del instructor no consta en el encabezado de la transcripción. La ruta relativa a la biblioteca comienza en `Java/Spring Cloud y Microservicios/`. La lección distingue las señales de observabilidad y explica el papel del formato de exportación. El nombre oficial del protocolo es OTLP, según [F6 · OpenTelemetry en Nest](https://docs.nestjs.com/observability/opentelemetry).

La búsqueda de originales en la biblioteca NestJS no encontró una lección sobre `@nestjs/observe`. La lección 159 es conceptual y el código de las lecciones cercanas instrumenta Spring. Para el plan de Observe, la documentación oficial respalda el código futuro y la transcripción aporta contexto conceptual. No se generó una guía de reconstrucción.
