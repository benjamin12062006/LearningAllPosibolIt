# 01 — Decisión de usar NestJS Observe

Fecha de creación: 2026-11-13  
Estado: Plan e investigación documentados  
Ámbito: API Nest de KTSU  
Revisión de partida: `3733be48a09be170df92d791a40c5d897e864b9f`, con cambios locales en curso.  
Relacionada con: [plan](../docs/plans/01-integrar-nestjs-observe.md), [base de observabilidad E6](../../bitacora-construccion/feature/jobs&files/05-observabilidad.md).

## Decisión y evidencia

El usuario eligió NestJS Observe para la API. Se instrumentará el proceso Nest con el SDK oficial dentro de su imagen y se consultarán sus trazas desde el panel del proveedor. Los registros de infraestructura y aplicación se consultarán en Google Cloud según el despliegue. La carpeta `observability/` reúne documentación de una responsabilidad transversal del backend. [F1–F2 · SDK oficial](../docs/fonts/01-sdk-oficial-y-cobertura.md) · [F12–F17 · Contexto operativo](../docs/fonts/03-contenedor-google-cloud-y-cursos.md)

El plan reutiliza IDs, salud y registros del backend. La primera activación propuesta es staging con datos sintéticos y captura mínima. La instrumentación de colas PostgreSQL y la correlación de errores GraphQL requieren una prueba específica. [F4–F5 · Cobertura](../docs/fonts/01-sdk-oficial-y-cobertura.md) · [F7–F8 · Captura](../docs/fonts/02-datos-coste-y-operacion.md)

## Comprobaciones de esta etapa

| Comprobación | Resultado |
| --- | --- |
| Estado Git, bootstrap, configuración HTTP, salud, colas y cliente de IA | Se identificaron la revisión base, el árbol de trabajo en curso y los puntos de integración. |
| `gcloud version` | Google Cloud SDK 587.0.0 disponible localmente. |
| Consulta de originales y documentación oficial | Las fichas registran las APIs documentadas y el contexto conceptual recuperado. |

La próxima entrada debe registrar la implementación y la evidencia obtenida al ejecutar los casos del plan. El SDK, las credenciales, la imagen y el entorno de staging están pendientes de esa etapa.
