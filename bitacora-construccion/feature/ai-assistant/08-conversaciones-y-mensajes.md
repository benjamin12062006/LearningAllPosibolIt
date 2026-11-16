# 08 — Conversaciones privadas y mensajes idempotentes

Fecha de creación: 2026-11-14  
Última actualización: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Código de otra sesión, cerrado en esta.  
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

## Cierre (2026-11-14)

La implementación la dejó escrita otra sesión (punto de control `b6aada9`); esta sesión la verificó y cerró sin cambios de código.

- **Migración 36** (`20261114130000_create_ai_conversations`): `ai_conversations` y `ai_messages`, con claves foráneas compuestas a libro y hoja, secuencia única por conversación y `clientMessageId` único por autor.
- **Pruebas:** 10 E2E en [`conversations.e2e-spec.ts`](../../../test/features/conversations/conversations.e2e-spec.ts), 3 del DTO y 1 de paridad GraphQL. Pasan.
- **Defectos a propósito: 6 de 6 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | E62-1 | Conversaciones de otros autores | Sí |
  | E62-2 | Sin comprobar la membresía | Sí |
  | E62-3 | Escribir sin `ai.use` | Sí |
  | E62-4 | Libro u hoja archivados aceptados | Sí |
  | E62-5 | Reintento con otro texto aceptado | Sí |
  | E62-6 | Secuencia con huecos | Sí |

- La batería completa, el esquema frente a migraciones y el arranque real se ejecutan al cerrar el Bloque C con todo junto (bitácora de cierre).
- La migración 36 la aplica el usuario en Cloud SQL.
