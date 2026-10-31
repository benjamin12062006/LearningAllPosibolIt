# 02 — Semillas de desarrollo con Prisma

Fecha de creación: 2026-10-30  
Última actualización: 2026-10-30  
Estado: Plan. Investigación ampliada completada en la [fuente db/05](../../fonts/db/05-curso-nest-semilla-reconstrucciones.md); implementación pendiente.  
Ámbito: datos de desarrollo de `app_users`, `projects` y `catalog-import`.  
Relacionada con: [fuente db/02: curso Nest](../../fonts/db/02-curso-nest-semillas-y-eliminacion.md), [fuente db/03: Prisma](../../fonts/db/03-documentacion-prisma-seed-y-acciones-referenciales.md), [fuente db/05: semilla en todos los cursos de Nest](../../fonts/db/05-curso-nest-semilla-reconstrucciones.md), [plan de eliminación](03-plan-eliminacion-de-datos.md), [plan de testing](../config/01-testing-nest-para-futuras-features.md).  
Revisión de referencia: `78e99f3`.

## Objetivo

Que un desarrollador pueda llenar una base **de desarrollo** con datos representativos ejecutando un solo comando, repetirlo sin duplicados y deshacerlo sin tocar datos ajenos. El plan estará completo cuando `pnpm db:seed`:

- cree los datos;
- al volver a ejecutarse no cambie nada;
- se niegue a ejecutarse contra un destino no permitido.

## Punto de partida

- No hay semilla. [prisma.config.ts](../../../prisma.config.ts) no define `migrations.seed` y no existe `db:seed`.
- Relacionados que existen:
  - `pnpm db:smoke` ([smoke-postgres.mjs](../../../scripts/db/smoke-postgres.mjs)), que crea o reutiliza un usuario ficticio para probar la conexión.
  - [project-fixtures.ts](../../../test/features/support/project-fixtures.ts), usado solo en los tests con PGlite.
- El único PostgreSQL configurado es Cloud SQL, compartido con datos reales en `estadistica_forms`. No hay una base de desarrollo local definida.
- Los usuarios dependen de Descope (`identity_issuer`, `identity_subject`). Un usuario sembrado no puede iniciar sesión salvo que se asocie a una cuenta de prueba real.
- Un snapshot `ready` necesita su archivo en `CATALOG_IMPORT_ROOT`; no basta con insertar filas.

## Fuentes y decisiones

- **Curso (F1, F4 de la fuente db/02):** la semilla vive en un componente propio, reutiliza servicios de otros módulos exportándolos y se puede repetir.
- **Prisma 7 (F5 de la fuente db/03):** `migrations.seed` y `prisma db seed`, solo bajo demanda.
- **Adaptación:**
  - Comando CLI en lugar del `GET /seed` del curso, para no exponer una operación destructiva por HTTP.
  - En lugar de «borrar todo», insertar solo filas marcadas como semilla.
- **Decisiones abiertas:**
  - **D1 — base de desarrollo:** PGlite con socket (ya en `devDependencies`), PostgreSQL en Docker, o una base o esquema separado en Cloud SQL.
  - **D2 — método:** SQL directo o un contexto de aplicación Nest (`NestFactory.createApplicationContext`) que reutilice `ProjectsService` y el flujo de importación.
  - **D3 — sesión real:** si se asocian los datos sembrados a `DESCOPE_TEST_LOGIN_ID` para probar con una sesión de verdad.

## Incrementos

1. **Decidir D1–D3** y registrarlo en este plan.
2. **Protección del destino.** El script solo se ejecuta con una variable explícita (nombre propuesto: `SEED_ALLOWED=true`) y una lista de destinos permitidos (host local o base o esquema de desarrollo). Ante cualquier otro destino, aborta sin escribir.
3. **Datos mínimos que se pueden repetir.** IDs fijos (UUID) e inserciones con `ON CONFLICT DO NOTHING`:
   - dos usuarios (Alice y Bob) para probar el acceso cruzado;
   - un proyecto configurado y otro sin configurar;
   - el emisor de identidad identifica las filas sembradas (valor propuesto: `seed`).
4. **Catálogo de ejemplo.** Un CSV de ejemplo versionado (por ejemplo, `prisma/seed-data/catalogo-ejemplo.csv`) importado con el mismo mecanismo que la API, para generar el archivo, el snapshot, las filas y el trabajo de forma coherente.
5. **Deshacer.** `pnpm db:seed -- --reset` borra únicamente los datos sembrados. Depende del [plan de eliminación](03-plan-eliminacion-de-datos.md), que define cómo borrar un proyecto con sus importaciones y archivos.
6. **Documentar** en el README cuándo usar `db:seed`, `db:smoke` y los datos de prueba de los tests, y por qué no se siembra Cloud SQL de producción.

## Comprobación prevista

- Ejecutar `db:seed` dos veces seguidas: los conteos no cambian.
- Ejecutarlo con un destino no permitido: aborta sin escribir.
- Comprobar `--reset`: después no queda ninguna fila ni archivo con la marca de semilla y los demás datos siguen intactos.
- Regresión: `pnpm build`, `pnpm test:features`.

## Límites y continuidad

- No sustituye a los datos de prueba de los tests ni a `db:smoke`.
- No crea cuentas en Descope.
- La investigación de las lecciones 93–96 y 148, y del resto de lecciones de semilla de los dos cursos, está en la [fuente db/05](../../fonts/db/05-curso-nest-semilla-reconstrucciones.md) (R1–R16). Apoya D2 (reutilizar los servicios) y el orden de borrado del incremento 5.
- Este plan es anterior al cambio a Neon ([bitácora 12](../../../bitacora-construccion/settings/12-cambiar-cloud-sql-por-neon.md)): donde dice Cloud SQL, hoy se aplica igual a Neon, la única base configurada.
