# estadistica-forms-api

Backend de formularios, estadísticas e investigación, construido paso a paso con **NestJS + TypeScript + pnpm**. Ya dispone de identidad validada, perfil local y proyectos privados persistidos con configuración de tienda.

El código usa **PostgreSQL de Google Cloud SQL** mediante ADC, Cloud SQL Node.js
Connector, `pg` y Prisma 7.10.0. El [plan](docs/plans/feature/auth/04-sustituir-turso-por-cloud-sql-postgresql.md)
y la [activación verificada](./bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md)
registran la integración y su comprobación real.
Descope conserva la identidad y la sesión; PostgreSQL almacena el perfil y los proyectos en `estadistica_forms.projects`. La migración conserva los IDs y datos anteriores.

`prisma/migrations` contiene únicamente la historia PostgreSQL activa.
La integración anterior se retiró tras guardar el commit local de restauración
`a551ed8`; la [entrada 09](./bitacora-construccion/settings/09-retirar-turso-tras-guardar-restauracion.md)
registra el alcance. El proyecto ya no incluye una segunda conexión ni migraciones
alternativas. No se eliminaron bases remotas ni sus datos.

## Configurar Cloud SQL

Completa el `.env` existente a partir de [`.env.example`](./.env.example), conservando
`DESCOPE_PROJECT_ID` y los secretos de Descope que ya utilizas:

```dotenv
GOOGLE_CLOUD_QUOTA_PROJECT=expo-city-bol
INSTANCE_CONNECTION_NAME=expo-city-bol:us-east4:expo-city-bol-instance
DB_NAME=expo-city-bol-database
DB_USER=catalogo_api
DB_PASSWORD='contraseña-del-usuario-PostgreSQL'
POSTGRES_MIGRATION_DATABASE_URL='postgresql://propietario:contraseña-codificada@127.0.0.1:5433/expo-city-bol-database?schema=estadistica_forms&sslmode=disable'
```

`DB_USER` debe existir en PostgreSQL. Puedes usar la identidad SQL existente del
proyecto Go si tiene los permisos necesarios. El runtime requiere `USAGE` sobre
`estadistica_forms` y operaciones sobre sus tablas; la identidad de migración
requiere permisos para crear ese esquema y sus tablas. No se conceden permisos
ni se crean usuarios automáticamente.

La contraseña de `DB_PASSWORD` es literal. En la URL de migración, codifica los
componentes usuario y contraseña: por ejemplo, `@` como `%40` y `#` como `%23`.
La URL puede usar un propietario SQL distinto al usuario del runtime. No subas
estos valores a Git ni los añadas al frontend. El runtime usa las variables `DB_*`
y `INSTANCE_CONNECTION_NAME`; Prisma CLI usa `POSTGRES_MIGRATION_DATABASE_URL`.
La variable genérica `DATABASE_URL` no se utiliza como destino alternativo.

Si ADC no está configurado en esta Mac:

```sh
gcloud auth application-default login
gcloud auth application-default set-quota-project expo-city-bol
```

ADC permite abrir el canal Google y requiere Cloud SQL Client en la identidad.
`GOOGLE_CLOUD_QUOTA_PROJECT` selecciona el proyecto de cuota; no reemplaza el
usuario/contraseña SQL. No hace falta copiar un JSON de servicio si se usa ADC local.

## Migrar y comprobar

El runtime conecta directamente con Cloud SQL y no necesita proxy. Prisma CLI
sí requiere un extremo PostgreSQL. En otra terminal, para las migraciones:

```sh
cloud-sql-proxy --address 127.0.0.1 --port 5433 expo-city-bol:us-east4:expo-city-bol-instance
```

Con `POSTGRES_MIGRATION_DATABASE_URL` preparado, desde esta carpeta:

```sh
pnpm db:status
pnpm db:migrate
pnpm db:check
pnpm start:dev
```

`db:check` ejecuta únicamente una lectura: confirma conexión, base, usuario SQL y
existencia de `estadistica_forms.app_users`. Si `usersTableExists` es `false`,
la conexión funciona pero faltan las migraciones. El arranque de Nest no migra.
Las tablas se crean en `estadistica_forms`, no en `public`; la limpieza de tablas
del antiguo Go queda a cargo del usuario.

La activación remota del 2026-10-22 y el usuario ficticio consultado quedaron
registrados en la [entrada 07](./bitacora-construccion/settings/07-aplicar-migraciones-y-verificar-cloud-sql.md).
Para repetir la prueba de persistencia ejecuta `pnpm db:smoke`: crea o reutiliza
únicamente `postgresql-smoke@example.test`, comprueba idempotencia, edición y lectura
SQL, y conserva esa fila identificable. No crea una cuenta Descope ni omite el guard
HTTP. La consulta de lectura está en [requests/postgresql-smoke.sql](./requests/postgresql-smoke.sql).

Para cambios futuros usa `pnpm db:migration:create -- --name nombre` contra un
PostgreSQL de desarrollo aislado con shadow database disponible. Revisa el SQL
generado y aplica los cambios al destino remoto con `pnpm db:migrate`.

## Incrementos actuales: sesión, perfil y proyectos propios

### Requisitos e inicio

- Node.js **24 LTS**, según `engines`; `.nvmrc` fija **24.19.0**. Este incremento se verificó con **24.22.1**.
- pnpm **12.5.1**, registrado en `packageManager`.
- NestJS **12.0.3**, última versión estable consultada en npm el **19 de septiembre de 2026**. `pnpm-lock.yaml` fija las dependencias resueltas.

Si usas nvm, ejecuta `nvm install` y `nvm use` dentro de esta carpeta. Después:

```bash
pnpm install --frozen-lockfile
pnpm start:dev
```

`start:dev` recompila y reinicia la API al guardar archivos. Para iniciarla sin observación, usa `pnpm start`. Para ejecutar el resultado compilado:

```bash
pnpm build
pnpm start:prod
```

La API escucha localmente en `127.0.0.1:8080`. Se puede cambiar el puerto con `PORT=8081 pnpm start:dev`. La configuración actual está pensada para desarrollo local; el despliegue se abordará en otro incremento.

**Nota sobre este equipo:** la comprobación de projects se hizo con Node 24.22.1 del runtime de Codex, sin cambiar la instalación global. Usa la rama 24 indicada por `.nvmrc` y `engines` al trabajar desde tu terminal.

### Comprobar la sesión y los proyectos

```bash
curl -i http://127.0.0.1:8080/api/v1/auth/me
```

Sin sesión, responde `401 Unauthorized`. Con un `sessionJwt` válido del proyecto,
`GET /api/v1/auth/me` responde `200` con la identidad validada. No copies el token
en archivos versionados.

Para probar desde WebStorm, ejecuta `pnpm api:auth-test`, abre los archivos de
`requests/` y selecciona **local** en **Run with**. El JWT se guarda en
`requests/http-client.private.env.json`; todas las peticiones usan
`{{TEST_SESSION_JWT}}`. `pnpm api:request` utiliza el mismo entorno desde terminal.
La [guía HTTP](docs/autenticacion-descope/request.md) explica el orden y la captura
automática de IDs de proyectos e importaciones.

`GET` consulta; `/api` identifica la API y `/v1` identifica su contrato. La versión
de la URL es independiente de `package.json` y de los tags de Git. Un cambio
compatible no exige crear `/v2`.

La raíz `/` no tiene un controlador y responde `404`, al igual que una ruta desconocida. Con un `sessionJwt` temporal de Descope, aprovisiona primero el perfil local y después crea y lista proyectos:

```bash
curl -i -X PUT http://127.0.0.1:8080/api/v1/users/me \
  -H "Authorization: Bearer $TEST_SESSION_JWT"

curl -i -X POST http://127.0.0.1:8080/api/v1/projects \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TEST_SESSION_JWT" \
  --data '{"name":"Mi tienda","country":"BO","currency":"BOB","channelProfile":"google_merchant"}'

curl -i http://127.0.0.1:8080/api/v1/projects \
  -H "Authorization: Bearer $TEST_SESSION_JWT"
```

`GET /api/v1/users/me` lee el perfil y `PATCH /api/v1/users/me` permite cambiar únicamente `displayName`. Las rutas de proyectos requieren sesión y perfil local. El propietario se determina en el backend. Si el perfil local no existe, primero ejecuta `PUT /users/me`.

Las pruebas despliegan las migraciones con Prisma CLI sobre PostgreSQL temporal
PGlite y usan `pg`, el adaptador y el cliente Prisma reales. No escriben en bases
remotas. PGlite multiplexa conexiones: estas pruebas no sustituyen una prueba de
carga PostgreSQL ni un login real con Descope.

### Proyectos y configuración de tienda

La feature nueva vive en `src/projects`. Tras aprovisionar el perfil, `POST /api/v1/projects` recibe:

```json
{ "name": "Mi tienda", "country": "BO", "currency": "BOB", "channelProfile": "google_merchant" }
```

Responde `201 { project }`. `GET /api/v1/projects` devuelve `{ projects }`; `GET /api/v1/projects/:id` y `PATCH /api/v1/projects/:id` devuelven `{ project }`. Los IDs ajenos o ausentes responden `404`. El propietario siempre se obtiene de la sesión. Los códigos se recortan y convierten a mayúsculas, con validación ISO de país/moneda; el perfil inicial admitido es `google_merchant`.

`PATCH` acepta nombre y/o la terna completa de configuración, sin campos extra ni valores nulos. Un espacio anterior conserva ID, propietario, nombre y fecha; presenta configuración nula y `configurationStatus: "required"`. Al completarla pasa a `ready`. `ProjectsService.requireConfigured` devuelve `409 PROJECT_CONFIGURATION_REQUIRED` para la futura importación si falta esa configuración.

El código y la API de esta funcionalidad usan únicamente `projects`. Las rutas anteriores de espacios se retiraron y responden `404`.

La migración `20261025000100_configure_projects` renombra la tabla anterior a `projects`, sus restricciones e índice y añade configuración. La posterior `20261026000100_create_catalog_import` añade snapshots, filas y trabajos. Ambas se comprobaron sobre base temporal. **Aplicar las migraciones pendientes a Cloud SQL antes de ejecutar esta versión allí**, mediante `db:status` → `db:migrate`. La historia aplicada se conserva.

Peticiones manuales: [requests/projects.http](./requests/projects.http). Registro: [implementación de projects](./bitacora-construccion/feature/projects&catalog-import/02-implementar-projects.md).

### Importar un catálogo CSV privado

`POST /api/v1/projects/:projectId/imports` recibe multipart con un archivo `file`, `idColumn` obligatorio y `delimiter` opcional (`comma` o `semicolon`). Exige sesión, perfil local y proyecto propio/configurado antes de recibir el archivo. El nombre aportado por el cliente no determina su ubicación.

Responde **202** después de persistir archivo, snapshot y trabajo:

```json
{
  "snapshotId": "uuid-del-snapshot",
  "jobId": "uuid-del-trabajo",
  "status": "queued",
  "statusUrl": "/api/v1/projects/uuid-del-proyecto/jobs/uuid-del-trabajo"
}
```

`GET /api/v1/projects/:projectId/jobs/:jobId` devuelve `{ job }`, con estado `queued/running/succeeded/failed`, progreso y error público. `GET /api/v1/projects/:projectId/imports/:snapshotId` devuelve `{ snapshot, sample }`: hasta 20 filas solo con snapshot `ready`; en otros estados la muestra queda vacía. Nunca devuelve una ruta interna ni URL pública del archivo.

Los valores permanecen como strings, incluidos `000123`, espacios y precios originales. Admite UTF-8 estricto/BOM, LF/CRLF, comillas y saltos dentro de campos. Límites: 10 MiB, 5.000 registros de datos, 200 columnas y cabeceras únicas/no vacías de hasta 128 caracteres. IDs vacíos/duplicados o estructura inválida fallan el trabajo sin publicar contenido parcial. El límite de registro del parser es independiente; su comportamiento con UTF-8 se registra en bitácora.

Al existir cualquier snapshot, cambiar país/moneda/canal responde `409 PROJECT_CONFIGURATION_LOCKED`; renombrar sigue permitido. Repetir POST crea otra importación. Los errores de estas rutas incluyen `code`, `message` y `requestId`; la adopción bilingüe global sigue pendiente de su plan.

**Operación inicial:** una sola instancia API/worker y una importación activa. El worker consulta trabajos persistidos, espera lotes y reconcilia running interrumpidos al arrancar. Configurar `CATALOG_IMPORT_ROOT` en un volumen privado persistente; por defecto usa `.data/catalog-import`, excluido de Git. No montarlo como estático. La finalización sincroniza archivo y directorio; confirmar persistencia y semántica del volumen elegido antes del piloto.

Los temporales rechazados se retiran. Los archivos referenciados se conservan; un commit incierto con base inaccesible también conserva el final hasta comprobar referencias. No hay borrado automático por antigüedad: acordar retención y revisar `artifact_key` en `catalog_snapshots` antes de retirar un final. Evitar limpieza del volumen durante cargas activas.

Peticiones: [requests/catalog-import.http](./requests/catalog-import.http). Evidencia y límites: [bitácora 03](./bitacora-construccion/feature/projects&catalog-import/03-implementar-catalog-import.md).

### Consumirla desde el frontend

Desde JavaScript ejecutado en el navegador, tanto en Astro como en Next.js, una
petición protegida deberá incluir el JWT de sesión que proporcione Descope:

```js
const response = await fetch('http://127.0.0.1:8080/api/v1/users/me', {
  headers: { Authorization: `Bearer ${sessionJwt}` },
});
if (!response.ok) throw new Error(`La API respondió ${response.status}`);
const data = await response.json();
console.log(data.user);
```

CORS permite los orígenes locales `http://localhost:4321`, `http://127.0.0.1:4321` (Astro), `http://localhost:3000` y `http://127.0.0.1:3000` (Next.js). Si el frontend utiliza otro puerto, ajusta `origin` en `src/configure-http.ts`. CORS permite al navegador leer respuestas entre orígenes distintos; no autentica usuarios ni impide solicitudes de otros clientes HTTP.

Para inspeccionar los encabezados:

```bash
curl -i http://127.0.0.1:8080/api/v1/auth/me \
  -H 'Origin: http://localhost:4321'

curl -i -X OPTIONS http://127.0.0.1:8080/api/v1/auth/me \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST'
```

El segundo comando debe responder `204` y permitir ese origen. El frontend todavía no está conectado visualmente: ese será el siguiente incremento.

## Cómo está organizado ahora

```text
src/
├── main.ts
├── app.module.ts
├── auth/
├── database/
├── users/
└── projects/
    ├── projects.module.ts
    ├── projects.controller.ts
    ├── projects.service.ts
    ├── projects.repository.ts
    └── projects.dto.ts
```

El recorrido para proyectos es `guard de Descope → controller → servicio → usuario local → repositorio → Prisma/pg → Cloud SQL PostgreSQL`.

- `main.ts` crea la aplicación y configura el puerto; `configure-http.ts` comparte pipes, prefijo, versión y CORS con las pruebas HTTP.
- `AppModule` reúne los módulos de la aplicación.
- `ProjectsModule` agrupa proyectos y exporta `ProjectsService` para la futura importación.
- `ProjectsController` declara `@Controller('projects')`, recibe peticiones y delega el trabajo.
- Los DTOs y el `ValidationPipe` global validan el cuerpo; `ProjectsService` resuelve al usuario local y `ProjectsRepository` consulta PostgreSQL mediante `$queryRaw` parametrizado, filtrando por propietario.

Seguimos con módulos por funcionalidad. Los perfiles y espacios ya son persistentes; formularios, membresías y permisos compartidos vendrán en etapas posteriores.

**Dirección de crecimiento:** un monolito modular con controladores para HTTP, servicios para las reglas y acceso a datos separado cuando incorporemos persistencia. Las integraciones de análisis, IA y PDF tendrán límites claros cuando se implementen. Esa dirección no exige crear hoy carpetas, repositorios ni interfaces vacías.

## Cursos seleccionados y fuentes

La referencia principal es **Fernando Herrera**. Esta selección se basa en el temario publicado y en las transcripciones disponibles en la biblioteca local, no en afirmar que existe un único curso universalmente mejor.

| Prioridad               | Curso y nombre en la biblioteca                                                                                                  | Aplicación en este proyecto                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principal               | [Nest: Desarrollo backend escalable con Node](https://www.udemy.com/course/nest-framework/) — `NestJS Backend Completo`          | Fundamentos, TypeScript, REST, módulos, servicios, DTOs, validación, Docker, MongoDB, PostgreSQL, TypeORM, autenticación, autorización, OpenAPI, WebSockets y despliegue. Es el curso con la descripción que elegiste. |
| Complemento de calidad  | [NestJS + Testing: Pruebas unitarias y end to end (e2e)](https://www.udemy.com/course/nestjs-testing-e2e/) — `Testing en NestJS` | Pruebas de reglas, errores, permisos, controladores y flujo HTTP conforme crezca el sistema.                                                                                                                           |
| Complemento de informes | [NestJs + Reportes: Genera PDFs desde Node](https://www.udemy.com/course/nestjs-reportes/) — `Reportes PDF con NestJS`           | Documentos, tablas y gráficos cuando tengamos resultados que exportar.                                                                                                                                                 |

Los tres cursos seleccionados son de Fernando Herrera/DevTalles. No hace falta terminarlos todos antes de construir: consultaremos las clases que resuelvan el incremento actual.

También se revisó `NestJS API Profesional` ([NestJS Mastery: Build & Deploy a Production-Ready API](https://www.udemy.com/course/master-nestjs-the-javascript-nodejs-framework/)). Es una segunda referencia opcional para contrastar organización, pruebas y autorización, no una sustitución de Fernando. Su biblioteca incluye secciones marcadas `OLDER CONTENT`, que no se usarán como configuración vigente.

`Microservicios con NestJS` queda para una necesidad real de distribución. El primer producto es un backend modular. La persistencia elegida es Prisma con PostgreSQL de Cloud SQL y SQL parametrizado; las decisiones históricas de SQLite/Turso se conservan en la bitácora.

Estos cursos respaldan el backend y los informes. El análisis estadístico, la integración con IA y el uso de Polars requieren fuentes específicas adicionales cuando lleguemos a esa etapa.

### Transcripciones consultadas para este incremento

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/NestJS`.

- [30. Generar nuestro primer proyecto - CarDealership](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 3 Primeros pasos en Nest/30. Generar nuestro primer proyecto - CarDealership.md>): CLI, gestor de paquetes y ejecución en desarrollo.
- [31. Explicación de cada archivo y directorio](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 3 Primeros pasos en Nest/31. Explicación de cada archivo y directorio.md>): responsabilidades de los archivos iniciales.
- [32. Módulos](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 3 Primeros pasos en Nest/32. Módulos.md>): agrupar funcionalidades y partir de una base pequeña.
- [33. Controladores](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 3 Primeros pasos en Nest/33. Controladores.md>): módulo por funcionalidad, rutas con decoradores y respuesta HTTP.
- [36. Servicios](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 3 Primeros pasos en Nest/36. Servicios.md>): separar lógica reutilizable e inyectarla cuando sea necesaria.

Para seleccionar los complementos se consultaron [Testing: introducción a pruebas de módulos, controladores y servicios](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 4 Pruebas sobre módulos, controladores y servicios/22. Introducción.md>) y [Reportes: demostración del objetivo](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Reportes PDF con NestJS/Sección 2 Preparación de proyecto/7. Demostración del objetivo.md>). La segunda prepara datos con Prisma; aprovechar sus enseñanzas sobre PDF no obliga a cambiar el ORM de este proyecto.

### Qué procede del curso y qué adaptamos

**Del curso:** CLI oficial, TypeScript, Express como adaptador inicial, módulos por funcionalidad, controladores con decoradores, separación posterior de servicios y desarrollo incremental.

**Adaptación propia:** pnpm, Nest 12.0.3, rutas `/api/v1`, Descope, Prisma con PostgreSQL de Cloud SQL, DTOs con `class-validator` y `class-transformer`, puerto 8080 y orígenes locales. La configuración ESM y las importaciones `.js` provienen del CLI actual; no deben reemplazarse mecánicamente por las de una grabación anterior.

Las pruebas actuales de usuarios y conexión mantienen el runner integrado de Node. Las pruebas nuevas de proyectos siguen el [plan de testing](./docs/plans/config/01-testing-nest-para-futuras-features.md) con Jest, `@nestjs/testing` y Supertest; ambas suites usan PostgreSQL temporal migrado por Prisma. Se retiraron los tests y el comando específicos de espacios junto con esa API.

Para compatibilidad actual se contrastaron las [instrucciones oficiales de inicio](https://docs.nestjs.com/first-steps), [versionado de rutas](https://docs.nestjs.com/techniques/versioning) y [CORS](https://docs.nestjs.com/security/cors). La versión se consultó con `pnpm view @nestjs/core version` y se fijó en `package.json`.

## Método de trabajo

Este proyecto aplica [construir-desde-cursos](/Users/benji/.agents/skills/construir-desde-cursos/SKILL.md) y [filosofia-de-trabajo](/Users/benji/.agents/skills/filosofia-de-trabajo/SKILL.md):

1. Leer el estado actual de los archivos y definir un incremento observable.
2. Consultar primero la clase pertinente de Fernando y explicar el concepto.
3. Adaptarlo a nuestro problema, distinguiendo la fuente de nuestras decisiones.
4. Implementar únicamente las piezas necesarias.
5. Verificar el resultado antes de añadir el siguiente escalón.

El objetivo es una plataforma de formularios y resultados compartidos para educación e investigación. Ya existen perfiles y espacios privados; Nuxt y Flutter consumen el contrato de sesión y perfil. Las siguientes features de producto se definen en `../docs/product/`.

Comprobaciones disponibles:

```bash
pnpm build
pnpm lint
pnpm format:check
pnpm db:verify
pnpm users:verify
pnpm test:features
```

Las peticiones manuales están en [requests/users.http](./requests/users.http), [requests/projects.http](./requests/projects.http) y [requests/catalog-import.http](./requests/catalog-import.http); requieren un JWT real no versionado. La suite HTTP comprueba proyectos e importación con guard real y proveedor Descope controlado. Formularios, membresías, WebSockets, informes y evaluación comercial quedan fuera de este incremento.

### Pruebas nuevas de features

Los errores HTTP de auth, usuarios, proyectos e importación comparten este contrato:

```json
{
  "statusCode": 404,
  "code": "PROJECT_NOT_FOUND",
  "message": { "es": "Proyecto no encontrado.", "en": "Project not found." },
  "requestId": "identificador-generado-por-el-servidor"
}
```

Las validaciones añaden `issues: [{ field, code, message: { es, en } }]`. El cliente decide por código/estado y presenta `message.es` o `message.en`; siempre recibe ambas traducciones. Los errores inesperados responden 500 genérico sin diagnóstico interno. Jobs y snapshots fallidos incluyen el mismo mensaje bilingüe dentro de `error`, incluso si fueron guardados con texto antiguo. Las respuestas exitosas conservan sus datos. Véase la [implementación y verificación](./bitacora-construccion/settings/11-mensajes-y-errores-bilingues.md).

```bash
pnpm test:features:unit
pnpm test:features:integration
pnpm test:features:e2e
pnpm test:features:watch
pnpm test:features:cov
# Un caso concreto; los argumentos se envían a Jest:
pnpm test:features:unit --testNamePattern='lista usando'
```

La compilación genera tipos Prisma sin leer `.env`, limpia `.test-build` y compila producción más `test/features` como ESM con metadatos de decoradores. Jest descubre únicamente los tests nuevos compilados; los tipos se importan desde `@jest/globals`. El build productivo excluye los tests. Jest usa `--experimental-vm-modules` en Node 24; su aviso de experimental es esperado.

Las suites tienen proyectos Jest separados `unit/integration/e2e`. Las unitarias crean dobles nuevos por caso e inyectan el servicio real. Integración/HTTP usan Prisma y PostgreSQL temporal PGlite/socket con migraciones locales y limpieza. HTTP sustituye Descope y `POSTGRESQL_CONNECTION` antes de compilar el módulo; mantiene el guard real. Los nuevos tests no cargan `.env`, ADC ni Cloud SQL. La cobertura queda en `coverage/features/`; estas pruebas no verifican login externo ni carga multiproceso de Cloud SQL. Véase la [bitácora de testing](./bitacora-construccion/settings/10-testing-nest-para-features.md).
