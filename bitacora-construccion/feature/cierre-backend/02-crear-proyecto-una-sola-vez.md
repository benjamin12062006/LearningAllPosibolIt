# 02 — C2: crear un proyecto una sola vez

Fecha de creación: 2026-11-08  
Última actualización: 2026-11-08  
Estado: Implementado y verificado. El bloqueo con dos peticiones simultáneas se probó en C3 ([bitácora 03](03-concurrencia-en-postgresql-real.md)).  
Relacionada con: [plan 01 de cierre](../../../docs/plans/feature/cierre-backend/01-plan-cierre-de-pendientes.md) (P2), [fuentes 01](../../../docs/fonts/feature/cierre-backend/01-estado-de-los-pendientes.md) (E5), [bitácora C1](01-bateria-estable.md), [plan de E4](../../../docs/plans/feature/changesets/01-plan-e4-borradores-y-revisiones.md) (D8, recibos).  
Revisión de partida: `main` `c280506` más C1 sin commit.

## Necesidad

Un doble clic en «Crear proyecto» manda dos `POST /projects` y crea dos proyectos. Los recibos de operación de E4 ya resuelven esto para `apply`; falta usarlos aquí, sin cambiar la ruta para quien no envíe la cabecera.

## Decisiones concretas (sobre P2)

- **Cabecera opcional.** Sin `Idempotency-Key`, la ruta hace exactamente lo de hoy (sin bloqueos nuevos). Si llega, se valida como en `apply` (de 1 a 255 caracteres tras quitar espacios; si no, 400 `IDEMPOTENCY_KEY_REQUIRED`). La validación pasa a una función común que usan las dos rutas.
- **Recibo** en `operation_receipts`: organización personal, actor, operación `project.create`, recurso = la organización y la clave. El hash es el del cuerpo validado (nombre, país, moneda y canal).
- **En fila.** Con clave, se bloquea la fila de la organización personal (`lockOrganization`) antes de buscar el recibo: dos peticiones simultáneas con la misma clave no pueden pasar a la vez.
- **Misma clave, mismo cuerpo:** 201 con el mismo proyecto, leído otra vez. El recibo guarda solo el id del proyecto, así no hay que forzar el tipo de un JSON guardado. Si el proyecto ya se borró, 404 `PROJECT_NOT_FOUND`. **Misma clave, otro cuerpo:** 422 `IDEMPOTENCY_KEY_REUSED`, como en `apply`.
- **GraphQL `createProject`** no cambia.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| E5 de la ficha: `operation_receipts`, `findReceipt` y `saveReceipt` ya existen (E4, D8); el plan de jobs&files dejó esta ruta pendiente solo por no crear una infraestructura para ella | Reutilizar los recibos con una clave opcional | `ProjectsRepository.create(…, idempotency)`, `ProjectIdempotency`, `CREATE_OPERATION = 'project.create'` |
| `apply` valida la clave con su propia función privada | Una sola validación para las dos rutas, sin cambiar la de `apply` | [`parseIdempotencyKey`](../../../src/common/http/idempotency-key.ts), que usan `ChangesetsService.apply` y `ProjectsService.create` |
| `ensurePersonalOrganization` no bloquea nada si la organización ya existe; buscar un recibo con `FOR UPDATE` no bloquea una fila que todavía no existe | Con clave, bloquear la organización antes de buscar el recibo | `lockOrganization(tx, organizationId)` en `create` |
| Un JSON guardado no garantiza su forma | Guardar solo `{ projectId }` y volver a leer el proyecto | `findCreatedProject` e `isCreatedProjectReceipt` |

## Ajustes al escribir el código

- **El cuarto argumento solo se pasa con clave.** Una prueba existente comprueba los argumentos exactos de `repository.create`. En lugar de cambiar esa aserción, el servicio llama sin cuarto argumento cuando no hay clave, el mismo criterio que en E5.4.
- **El hash se calcula sobre el cuerpo ya normalizado por el DTO** (nombre sin espacios, códigos en mayúsculas): `" Tienda A "` y `"Tienda A"` con la misma clave son la misma petición.
- **Sin el bloqueo no se duplicaría el proyecto en PostgreSQL**, pero la segunda petición fallaría con 500: las dos buscarían el recibo a la vez, las dos insertarían, y la clave primaria del recibo haría fallar la segunda transacción. Con el bloqueo, la segunda espera y responde 201 con el mismo proyecto.

## Implementación

- `src/common/http/idempotency-key.ts` (nuevo): `parseIdempotencyKey`.
- `src/changesets/changesets.service.ts`: usa `parseIdempotencyKey` en lugar de su función privada; mismo comportamiento.
- `src/projects/projects.controller.ts`: lee la cabecera `Idempotency-Key` (CORS ya la admitía).
- `src/projects/projects.service.ts`: `create(identity, input, idempotencyKey?)` e `idempotencyOf` (hash de nombre, país, moneda y canal).
- `src/projects/projects.repository.ts`: `create(…, idempotency = null)`, `insertProject`, `findCreatedProject`, `isCreatedProjectReceipt`.
- Sin migración: la tabla de recibos ya existe.

## Comprobaciones realmente ejecutadas

2026-11-08, Node 26.9.

- **E2E nuevas** en `projects.e2e-spec.ts` (6):
  - misma clave y mismo cuerpo, también con espacios distintos, devuelven el mismo proyecto;
  - dos peticiones simultáneas con la misma clave crean uno solo;
  - la misma clave con otro cuerpo da 422 y no crea nada;
  - sin clave, dos proyectos como siempre, y una clave vacía o de 256 caracteres da 400;
  - Bob, con la misma clave, crea el suyo;
  - un proyecto ya borrado da 404 y no se crea otra vez.
- Pruebas de proyectos y borradores: 127, todas pasan. **Suite completa**: 86 suites y 1.449 pruebas (antes de C2: 1.443).
- `tsc --noEmit`, `pnpm lint` y `prettier --check src test/features`: limpios.
- **Defectos a propósito** (copia limpia, pruebas de proyectos y borradores):

  | Defecto | Resultado |
  | --- | --- |
  | Recibo guardado con otra clave | Detectado (4 pruebas) |
  | Ignorar el hash | Detectado |
  | Hash sin el nombre | Detectado |
  | Clave sin validar | Detectado |
  | Validación común sin límite de longitud | Detectado |
  | **Sin el bloqueo de la organización** | **No detectado.** PGlite ejecuta las transacciones de una en una, así que dos peticiones simultáneas no compiten. Se prueba en C3 contra PostgreSQL real. |

## Consecuencias

- El cliente web puede enviar una `Idempotency-Key` por cada intento de «Crear proyecto»; los clientes que no la envían no cambian.
- GraphQL `createProject` sigue sin clave (C7 decidirá si la expone).
- **Pendiente para C3:** la prueba del doble clic con dos conexiones reales.
