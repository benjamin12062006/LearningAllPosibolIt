# 01 — Fuentes para organizaciones, roles y acceso

Fecha de creación: 2026-11-02  
Estado: Investigación que respalda el [plan 01](../../../plans/feature/organizations&access/01-plan-organizaciones-y-acceso.md).  
Relacionada con: [transición del backend](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), [fuentes de la ampliación](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md) (C1, C2, F1, F2, F6), [acta E0](../../../../../docs-diagrams/21-acta-e0-adelantar-la-ampliacion.md).

## Cursos

Curso: **Go from zero to a deployed & tested NestJS API with TypeScript, TypeORM, PostgreSQL & Docker** (carpeta `NestJS/NestJS API Profesional`). Sección 9, «Advanced Security: Authorization, Roles & Data Ownership». El instructor no consta en los archivos. Ruta relativa a la biblioteca `/Users/benji/Documents/chrome-extencions/trancripciones/`: `NestJS/NestJS API Profesional/Sección 9 Advanced Security Authorization, Roles & Data Ownership/`. Consulta: 2026-11-02. No se reconstruyó código: los pasajes explican el mecanismo y el proyecto usa otro ORM y otro proveedor de identidad.

| ID | Lección y localizador | Evidencia | Uso en el proyecto |
| --- | --- | --- | --- |
| C3 | `110. Beyond Login Embedding User Roles into Your JWTs (RBAC).md`, línea 19; búsqueda «store the roles in the token» | Guarda los roles en el JWT para no consultar la base en cada petición. | **Descartado.** Aquí el rol depende de la organización y la revocación no puede esperar a que caduque el token ([11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md), «Modelo de acceso»). El rol se lee de `organization_members` en cada petición. |
| C4 | `111. Building an Admin-Only Area with a Role-Based Guard.md`, líneas 17–21; búsqueda «create a guard» | Decorador de metadatos `@Roles()` y un guard que compara roles globales del usuario. | **Aplazado.** Un guard de roles globales no sabe de qué organización es el recurso. E1.1 resuelve el acceso en el servicio a partir del recurso pedido. Un guard o decorador se valorará cuando haya varias operaciones de escritura con el mismo patrón. |
| C5 | `113. The Most Important Security Rule Data Ownership (Preventing Cross-User Access).md`, línea 15; búsqueda «403 means maybe you are authenticated» | 401 es sin autenticar; 403, autenticado sin permiso para ese recurso. | Se combina con la regla de [11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md): recurso ajeno → `404` (no revela que existe); recurso visible sin permiso de acción → `403`. |
| C6 | `120. Applying the Fix Scoping the Main Task List to the Current User.md`, línea 15; `119. Final Verification (Test) Ensuring the Task List is Correctly Scoped.md`, líneas 13–17 | El listado se acota con un `where` por usuario en la consulta, y se prueba con un segundo usuario que no ve nada ajeno. | Las consultas de organizaciones y proyectos llevan la membresía del usuario en el `WHERE`, no solo una comprobación previa en el servicio. Las pruebas usan dos usuarios. |

Segundo curso: **Aprende los conceptos fundamentales de la Arquitectura de Software**, carpeta `Arquitectura/Clean Architecture - Fundamentos`, sección 8 «Clean Architecture». Instructor no consta en el archivo. Consulta: 2026-11-02.

| ID | Lección y localizador | Evidencia | Uso en el proyecto |
| --- | --- | --- | --- |
| C7 | `58. La Regla de Dependencia.md`, líneas 15–17; búsqueda «los de adentro no deberían conocer a los de afuera» | Las dependencias van en una sola dirección: lo de mayor nivel no conoce lo que depende de él. | Adaptación propia a módulos Nest (O9): `OrganizationsModule` no importa proyectos; `ProjectsModule` importa organizaciones, porque un proyecto pertenece a una empresa. Hojas, revisiones e IA dependerán de proyectos, nunca al revés. |

## Documentación oficial

Consulta: 2026-11-02.

| ID | Fuente y sección | Evidencia | Uso |
| --- | --- | --- | --- |
| F31 | [PostgreSQL 17 — 9.14 UUID Functions](https://www.postgresql.org/docs/17/functions-uuid.html) | «PostgreSQL includes one function to generate a UUID: gen_random_uuid»; devuelve un UUID v4. | La migración genera los IDs de las organizaciones heredadas en SQL, sin extensión. Neon y PGlite usan PostgreSQL ≥ 13. |
| F32 | [PostgreSQL 17 — INSERT, `ON CONFLICT`](https://www.postgresql.org/docs/17/sql-insert.html) | `ON CONFLICT DO NOTHING` evita la inserción como acción alternativa. | Crear la organización personal y su membresía es idempotente: repetir el paso no duplica filas. |
| F34 | [Prisma ORM v7 — Transactions and batch queries](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), «Interactive transactions» | Si la función lanza una excepción, Prisma hace «automatically rollback the transaction»; toda llamada sobre `tx` queda dentro de la transacción. | Crear un proyecto asegura la organización personal y la membresía con el mismo `tx` (O5): si el perfil no existe o el `INSERT` falla, no queda una organización a medias. Misma página que F2 de [19](../../../../../docs-diagrams/19-fuentes-trazabilidad-y-decisiones-pendientes.md), versión v7 instalada. |
| F33 | [PostgreSQL 17 — 62.5 Index Uniqueness Checks](https://www.postgresql.org/docs/17/index-unique-checks.html) | Si otra transacción sin confirmar insertó la fila en conflicto, la nueva «must wait to see if that transaction commits». | Dos primeras creaciones de proyecto simultáneas del mismo usuario: la segunda espera y no crea otra organización; luego la lee. |

## Límites

Los cursos usan TypeORM, roles globales y JWT propios; aquí hay Prisma con SQL, Descope y roles por organización. Las tablas, nombres de permisos y la transición son propuesta del proyecto ([11](../../../../../docs-diagrams/11-backend-nest-organizaciones-y-transicion.md)), no del instructor.
