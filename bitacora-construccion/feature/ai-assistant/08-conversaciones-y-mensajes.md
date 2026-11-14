# 08 — Conversaciones privadas y mensajes idempotentes

Fecha de creación: 2026-11-14  
Última actualización: 2026-11-14  
Estado: En curso.  
Ámbito: Nest, E6.2 del Bloque C.  
Relacionada con: [etapa anterior E6.1b.2](07-conocimiento-de-hojas-y-organizacion.md), [fuentes 05](../../../docs/fonts/feature/ai-assistant/05-fuentes-de-conversaciones-y-mensajes.md), [plan 03](../../../docs/plans/feature/ai-assistant/03-plan-conversaciones-y-mensajes.md).  
Revisión de partida: Nest `7be788b`.

## Necesidad

Persistir en Nest un historial que su autor pueda volver a abrir y que tolere los reintentos del navegador. E6.1b.2 ya tiene verificación local con Nest, FastAPI y Qdrant.

## Evidencia y aplicación prevista

| Evidencia | Decisión | Aplicación prevista |
| --- | --- | --- |
| H1, C1/RC1 y C2/RC2 | Dar identidad y ámbito a la conversación. | Un módulo propio y dos tablas con claves foráneas. |
| H1, H4, E1 y E2 | Autorizar por ámbito, autor y sesión vigente. | Consultas privadas y escritura con permiso y bloqueo dentro de transacción. |
| H2, C3/RC2 y E2 | Recuperar el mismo mensaje en un reintento válido. | Unicidad por conversación, autor y clave, contenido normalizado y secuencia positiva. |
| H3–H4 y E4–E5 | Persistir el mensaje antes de iniciar el run. | POST del mensaje con 201 y consulta paginada. La ejecución con 202 llega en E6.3a. |

## Comprobaciones realizadas

| Comprobación | Resultado |
| --- | --- |
| Contraste del diseño, fuentes y módulos de acceso | Se verificaron las rutas previstas, el permiso `ai.use` y la integración de la matriz C7. |
| `reconstruction.py verify` | 2 guías y 3 transcripciones verificadas. |
| Preparación de la base local | Se verificó que Prisma acepta el diff entre datamodelos. El sandbox devolvió `EPERM` al abrir el socket temporal de PGlite. |

Las comprobaciones de código, la migración de E6.2 y la tabla de defectos quedan para la implementación. El contrato y los casos de aceptación están en el plan vinculado.
