# 02 — Captura de datos y operación del panel

Fecha de creación: 2026-11-13  
Tipo de fuente: documentación oficial de NestJS Observe  
Fecha de consulta: 2026-11-13  
Relacionada con: [SDK y cobertura](01-sdk-oficial-y-cobertura.md).

## Evidencia

| Fuente y sección | Evidencia aplicable |
| --- | --- |
| [F7 · Security & data, Where your data lives; What the SDK sends; Retention](https://www.observe.nestjs.com/security) | El proveedor declara alojamiento en AWS `us-east-1`. Requests, URLs, mensajes y stacks de error forman parte de los datos posibles. La captura puede adjuntar headers seleccionados y el SDK habilita por defecto el contexto de código del error. Hay retención y permisos por plan. |
| [F8 · SDK, Capturing failed and slow requests; Logs; Ignoring noisy operations](https://www.observe.nestjs.com/documentation/sdk) | `http.capture: false` elimina la captura opcional de headers y cuerpos. Las URLs y los mensajes de error requieren revisión propia. `sourceContext: false` va en la fábrica. `forwardLogs: false` mantiene los logs fuera del SaaS. `http.ignore` excluye operaciones completas y `queryParamsObfuscateRegex` permite enmascarar valores de query. |
| [F9 · Billing & usage, Events and Spend controls](https://www.observe.nestjs.com/documentation/billing) y [FAQ, Alerts vs. SLOs](https://www.observe.nestjs.com/documentation/faq) | Solicitudes, jobs, errores, logs y spans de aplicación retenidos consumen eventos. Retención, alertas y SLO dependen del plan. Muestreo, filtros de ingesta y presupuesto tienen efectos distintos sobre la señal que se conserva. |
| [F10 · Applications, API keys y Access control](https://www.observe.nestjs.com/documentation/applications) | El panel permite administrar proyectos, aplicaciones, credenciales y acceso del equipo. La separación por entorno y las credenciales por workload son decisiones operativas de KTSU. |
| [F11 · Production rules](https://docs.nestjs.com/observability/production-rules) y [Error monitoring, Getting notified](https://docs.nestjs.com/observability/error-monitoring) | Las reglas del producto evalúan trazas retenidas. Las alertas por tasa de fallo y sus destinos dependen del plan. Los fallos esperados y los defectos nuevos tienen tratamientos distintos. |

## Aplicación en KTSU

- Arrancar con datos sintéticos, `sourceContext: false`, `forwardLogs: false`, `http.capture: false`, sin `getUserId` y sin tags con datos de clientes. Revisar la URL del feed público en [configureHttp](../../../src/configure-http.ts), las rutas de IA con identificadores y la salida de Apollo. Excluir las operaciones con tokens en el path y mantener los spans HTTP salientes desactivados hasta verificar los destinos y los campos que quedarían visibles. [F7 · Campos enviados](https://www.observe.nestjs.com/security) · [F8 · Controles del SDK](https://www.observe.nestjs.com/documentation/sdk)
- Probar con valores sintéticos reconocibles en path, query, headers, cuerpo, variables GraphQL, SQL y mensajes de error. Revisar Observe y Cloud Logging, incluidos los logs de acceso de la plataforma y cualquier `Referer`. La exclusión en Observe solo actúa sobre la ingesta del SDK. Verificar en particular la detección de errores que contienen texto de dependencias, aunque el filtro público los transforme. [F5 · Error monitoring](https://docs.nestjs.com/observability/error-monitoring) · [F12 · Cloud Run Logging](https://docs.cloud.google.com/run/docs/logging)
- Usar dimensiones acotadas, como cola, resultado y operación. Registrar un identificador de correlación solo donde sea necesario para investigar un evento. Medir volumen por ambiente antes de elegir retención, muestreo y alertas. Mantener alertas de disponibilidad de plataforma aunque Observe alcance su cuota. [F9 · Uso](https://www.observe.nestjs.com/documentation/billing)
