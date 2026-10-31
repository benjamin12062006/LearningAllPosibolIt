# 05 — Cómo gestiona Fernando Herrera la semilla en Nest: lecciones y reconstrucciones

Fecha de creación: 2026-10-30
Tipo de fuente: transcripciones y reconstrucciones derivadas
Origen: Fernando Herrera, *Nest: Desarrollo backend escalable con Node* (carpeta local `NestJS/NestJS Backend Completo`, Udemy `nest-framework`) y *Nest + GraphQL* (carpeta `NestJS/NestJS GraphQL`, Udemy `nest-graphql`).
Fecha de consulta: 2026-10-30
Relacionada con: [plan de semillas db/02](../../plans/db/02-plan-semillas-de-desarrollo.md), [fuente db/02 (primera consulta)](02-curso-nest-semillas-y-eliminacion.md), [fuente db/03 (Prisma seed)](03-documentacion-prisma-seed-y-acciones-referenciales.md), [fuente db/04 (GraphQL, R15–R17 de la semilla)](04-curso-nest-graphql-reconstrucciones.md).

## Necesidad de consulta

El [plan db/02](../../plans/db/02-plan-semillas-de-desarrollo.md) dejó la investigación ampliada pendiente («lecciones 93–96 y 148») y tres decisiones abiertas (D1 base de desarrollo, D2 método, D3 sesión real). La [fuente db/02](02-curso-nest-semillas-y-eliminacion.md) solo había citado cuatro pasajes y la [db/04](04-curso-nest-graphql-reconstrucciones.md) reconstruyó las tres primeras lecciones de la semilla de GraphQL (111–113). El usuario pidió revisar a fondo cómo gestiona la semilla el instructor en todos los cursos de Nest de la biblioteca y reconstruir lo que falte.

## Localización verificable

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/NestJS/`. Se buscó con `buscar-aprendizaje-en-cursos` («seed», «semilla», «purgar», «inserción masiva», «seed usuarios») y por nombre de archivo. Los cursos *Microservicios con NestJS* y *Testing en NestJS* solo mencionan la palabra de pasada (máximo dos veces por lección), sin mecanismo de semilla: se descartan. Las líneas se verificaron con `nl -ba` y el script de reconstrucción comprobó cada frase en su línea.

Las transcripciones son reconocimiento de voz con mucho ruido: «SID», «Cid», «sit», «zip», «Shift» = seed; «Mojo»/«Mollo» = module; «acciones»/«access» = axios. El código no aparece literal: cada guía lo ensambla y declara su certeza.

### Inventario de lecciones sobre la semilla

| ID | Curso · sección | Lección | Uso |
| --- | --- | --- | --- |
| F1 | Backend Completo · 5 Brands CRUD | [61. Crear servicio SEED para cargar datos](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 5 Nest CLI Resource - Brands CRUD/61. Crear servicio SEED para cargar datos.md>) | R1 |
| F2 | Backend Completo · 5 | [62. Preparar servicios para insertar SEED](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 5 Nest CLI Resource - Brands CRUD/62. Preparar servicios para insertar SEED.md>) | R2 |
| F3 | Backend Completo · 5 | [63. Inyectar servicios en otros servicios](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 5 Nest CLI Resource - Brands CRUD/63. Inyectar servicios en otros servicios.md>) | R3 |
| F4 | Backend Completo · 8 Seed y Paginación | [90. Crear módulo SEED](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/90. Crear módulo SEED.md>) | R4 |
| F5 | Backend Completo · 8 | [92. Realizar petición http desde Nest](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/92. Realizar petición http desde Nest.md>) | R5 |
| F6 | Backend Completo · 8 | [93. Tarea - Insertar Pokemons por lote](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/93. Tarea - Insertar Pokemons por lote.md>) | Contexto de R6: solo enuncia la tarea, sin código |
| F7 | Backend Completo · 8 | [94. Resolución - Insertar Pokemons por lote](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/94. Resolución - Insertar Pokemons por lote.md>) | R6 |
| F8 | Backend Completo · 8 | [95. Insertar multiples registros simultáneamente](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/95. Insertar multiples registros simultáneamente.md>) | R7 |
| F9 | Backend Completo · 8 | [96. Crear un custom provider - opcional](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 8 Seed y Paginación/96. Crear un custom provider - opcional.md>) | R8 |
| F10 | Backend Completo · 11 Relaciones | [147. Product Seed](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 11 Relaciones en TypeORM/147. Product Seed.md>) | R9 |
| F11 | Backend Completo · 11 | [148. Insertar de forma masiva](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 11 Relaciones en TypeORM/148. Insertar de forma masiva.md>) | R10 |
| F12 | Backend Completo · 13 Autenticación | [186. SEED de usuarios, productos e imágenes](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 13 Autenticación de autorización/186. SEED de usuarios, productos e imágenes.md>) | R11 |
| F13 | Backend Completo · 13 | [187. Encriptar contraseña de los usuarios del SEED](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 13 Autenticación de autorización/187. Encriptar contraseña de los usuarios del SEED.md>) | R12 |
| — | GraphQL · 9 Seed Data | 111 Seed Resolver, 112 Protección, 113 Borrar registros | Ya reconstruidas: R15–R17 de la [fuente db/04](04-curso-nest-graphql-reconstrucciones.md) |
| F14 | GraphQL · 9 | [114. Seed - Paso 3 Crear usuarios](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 9 Seed Data - Cargar y purgar base de datos/114. Seed - Paso 3 Crear usuarios.md>) | R13 |
| F15 | GraphQL · 9 | [115. Seed - Paso 4 Crear items](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 9 Seed Data - Cargar y purgar base de datos/115. Seed - Paso 4 Crear items.md>) | R14 |
| F16 | GraphQL · 9 | [116. Actualización del Readme](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 9 Seed Data - Cargar y purgar base de datos/116. Actualización del Readme.md>) | Sin guía: solo añade un paso al README |
| F17 | GraphQL · 11 Maestro-detalle | [145. Lists y ListsItems - Seed Limpieza](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 11 Entidad para el manejo de listas Maestro Detalle/145. Lists y ListsItems - Seed Limpieza.md>) | R15 |
| F18 | GraphQL · 11 | [146. Lists y ListItems - Seed Inserción](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS GraphQL/Sección 11 Entidad para el manejo de listas Maestro Detalle/146. Lists y ListItems - Seed Inserción.md>) | R16 |

## Reconstrucciones (R1–R16)

Generadas con `reconstruir-cursos-con-scripts`: recetas JSON revisadas en [reconstrucciones/semilla/recetas](reconstrucciones/semilla/recetas/), `render` en dos salidas y `verify` correcto en ambas (12 guías y 15 originales con huella en Backend Completo; 4 guías y 5 originales en GraphQL). `install` creó las 16 guías junto a cada transcripción original sin sobrescribir ninguna. `verify` comprueba frases, líneas y huellas, no que el código compile ni que cada inferencia sea del instructor.

| ID | Lección | Mecanismo reconstruido | Guía |
| --- | --- | --- | --- |
| R1 | 61 | Recurso `seed` con un único `GET` → `SeedService.populateDB` | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 5 Nest CLI Resource - Brands CRUD/61. Crear servicio SEED para cargar datos - Reconstrucción guiada.md>) |
| R2 | 62 | Datos en `seed/data/*.seed.ts` tipados y métodos `fill…WithSeedData` | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 5 Nest CLI Resource - Brands CRUD/62. Preparar servicios para insertar SEED - Reconstrucción guiada.md>) |
| R3 | 63 | Exportar servicios, importar módulos en `SeedModule`, README | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 5 Nest CLI Resource - Brands CRUD/63. Inyectar servicios en otros servicios - Reconstrucción guiada.md>) |
| R4 | 90 | `SeedModule` del Pokedex: controlador delgado, lógica en servicio | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 8 Seed y Paginación/90. Crear módulo SEED - Reconstrucción guiada.md>) |
| R5 | 92 | Datos externos con axios, respuesta tipada y transformación | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 8 Seed y Paginación/92. Realizar petición http desde Nest - Reconstrucción guiada.md>) |
| R6 | 94 | `@InjectModel` en la semilla; `exports: [MongooseModule]` | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 8 Seed y Paginación/94. Resolución - Insertar Pokemons por lote - Reconstrucción guiada.md>) |
| R7 | 95 | Purga `deleteMany({})`, `Promise.all` frente a `insertMany` | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 8 Seed y Paginación/95. Insertar multiples registros simultáneamente - Reconstrucción guiada.md>) |
| R8 | 96 | Adaptador `HttpAdapter`/`AxiosAdapter` en `CommonModule` | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 8 Seed y Paginación/96. Crear un custom provider - opcional - Reconstrucción guiada.md>) |
| R9 | 147 | Semilla de teslo-shop: `runSeed` → `deleteAllProducts` de otro módulo | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 11 Relaciones en TypeORM/147. Product Seed - Reconstrucción guiada.md>) |
| R10 | 148 | Reutilizar `ProductsService.create` con `Promise.all` | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 11 Relaciones en TypeORM/148. Insertar de forma masiva - Reconstrucción guiada.md>) |
| R11 | 186 | `deleteTables` en orden, usuarios con repositorio, productos con el usuario guardado | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 13 Autenticación de autorización/186. SEED de usuarios, productos e imágenes - Reconstrucción guiada.md>) |
| R12 | 187 | `bcrypt.hashSync` en los datos de la semilla | [guía](<reconstrucciones/semilla/salida-2026-10-30-backend-completo/Sección 13 Autenticación de autorización/187. Encriptar contraseña de los usuarios del SEED - Reconstrucción guiada.md>) |
| R13 | 114 | `loadUsers` con `UsersService.create`, devuelve el primero | [guía](<reconstrucciones/semilla/salida-2026-10-30-graphql/Sección 9 Seed Data - Cargar y purgar base de datos/114. Seed - Paso 3 Crear usuarios - Reconstrucción guiada.md>) |
| R14 | 115 | `loadItems(user)` en paralelo con `Promise.all` | [guía](<reconstrucciones/semilla/salida-2026-10-30-graphql/Sección 9 Seed Data - Cargar y purgar base de datos/115. Seed - Paso 4 Crear items - Reconstrucción guiada.md>) |
| R15 | 145 | Purga `list_items → lists → items → users` | [guía](<reconstrucciones/semilla/salida-2026-10-30-graphql/Sección 11 Entidad para el manejo de listas Maestro Detalle/145. Lists y ListsItems - Seed Limpieza - Reconstrucción guiada.md>) |
| R16 | 146 | `loadLists` y `loadListItems` con los servicios y datos encadenados | [guía](<reconstrucciones/semilla/salida-2026-10-30-graphql/Sección 11 Entidad para el manejo de listas Maestro Detalle/146. Lists y ListItems - Seed Inserción - Reconstrucción guiada.md>) |

## Evidencia: el patrón del instructor

Lo que se repite en los dos cursos, de la primera versión en memoria a la de GraphQL:

1. **Para qué.** Dar datos de prueba a un desarrollador nuevo y recuperar la base tras un código destructivo; es una herramienta de desarrollo (F1, l. 15–17; F4, l. 15). «usualmente solo es en desarrollo que se utiliza el Cid» (F12, l. 13).
2. **Dónde.** Un recurso propio `seed` generado con el CLI, sin entidad ni DTO, con un único disparador: `GET /seed` en REST (R1, R4, R9) o la mutation `executeSeed` en GraphQL (db/04, R15). El controlador o resolver solo delega; la lógica está en `SeedService` (F4, l. 21–23).
3. **Datos.** Constantes TypeScript en `seed/data`, tipadas para que el compilador detecte datos mal formados (F2, l. 13; F11, l. 15; F14, l. 13). En GraphQL pasa a arreglos de objetos para poder añadir campos sin tocar la semilla (F18, l. 17).
4. **Acceso a otros módulos.** El módulo dueño exporta su servicio y, si hace falta, `TypeOrmModule`/`MongooseModule`; `SeedModule` importa ese módulo (R3, R6, R9, R15). Nunca se importa el servicio suelto.
5. **Repetible = purgar y volver a insertar.** Se borra todo antes de insertar para no chocar con índices únicos (F8, l. 19; F10, l. 15). El borrado va de hijos a padres por la integridad referencial: «tengo que borrarlos en cierto orden para evitar ese problema» (F12, l. 15). Cada tabla dependiente nueva se añade al principio de la purga (F17, l. 13–21).
6. **Insertar mediante el dominio.** Con MongoDB y datos simples recomienda una sola inserción masiva: «esto es lo que yo les recomendaría que hicieran para insertar sus semillas» (F8, l. 25, `insertMany`). Con relaciones cambia de criterio y reutiliza el `create` del servicio, porque «si no tendríamos que hacer el mismo procesamiento que hicimos a la hora de crearlo» (F11, l. 17). En GraphQL lo repite: «la idea es que utilicemos lo que ya tenemos para la creación» (F18, l. 19).
7. **Encadenar registros guardados.** Primero los padres, en secuencia, y se usa el registro devuelto (con su id) para crear los hijos (F12, l. 35; F14, l. 17–21). Los ids no se escriben a mano porque cambian en cada ejecución (F17, l. 33). Los hijos independientes se crean en paralelo con `Promise.all` (F11, l. 21–27; F15, l. 19–23).
8. **Mismos invariantes que la API.** Las contraseñas sembradas se hashean con la misma técnica que el registro, o el login falla (F13, l. 13–19). En GraphQL se consigue llamando a `UsersService.create`, que ya hashea (F14, l. 19).
9. **Protección.** En REST solo se sugiere restringirla por entorno, por base vacía o por rol (F8, l. 31). En GraphQL se bloquea con `STATE=prod` (db/04, R16). La semilla de teslo-shop queda sin `@Auth` mientras borra a los usuarios (F12, l. 33).
10. **Documentar.** Cada versión añade el paso al README (F3, l. 33; F8, l. 31; F11, l. 35; F16, l. 13–15).
11. **Datos externos.** Cuando vienen de una API, se tipa la respuesta y se encapsula el cliente HTTP en un adaptador inyectable (R5, R8).

## Interpretación y límites

- **Versiones y persistencia.** Los cursos usan Mongoose y TypeORM (Nest 9, 2022). Este proyecto usa Prisma 7 con SQL parametrizado y PostgreSQL en Neon. Se transfieren la organización y los criterios; los métodos del ORM (`deleteMany`, `insertMany`, `createQueryBuilder().delete()`), no.
- **Destino compartido.** El instructor borra tablas completas porque la base es solo de desarrollo. El plan db/02 no puede hacerlo: hoy la única base configurada es Neon con datos reales. Mientras no exista una base de desarrollo separada (D1), la regla 5 se adapta a borrar solo las filas marcadas como semilla.
- **Usuarios.** En el curso la API crea la cuenta y la contraseña. Aquí la identidad es de Descope: sembrar `app_users` no crea una cuenta que pueda iniciar sesión (D3). La regla 8 se traduce en respetar el mismo par emisor/sujeto y el mismo aprovisionamiento que usa `UsersService`.
- **Disparador.** El instructor siempre expone la semilla por HTTP o GraphQL y solo la protege por entorno. La decisión del plan db/02 de usar un comando CLI (`prisma db seed`) sigue siendo propia y no se atribuye al curso.
- **Fidelidad.** Las guías declaran como esqueletos los adjuntos que no aparecen en la transcripción (`seed-data.ts` de teslo-shop y de Anylist) y marcan con certeza media los nombres reconstruidos desde audio dudoso.

## Aplicación prevista en el proyecto (sin implementar)

```text
Regla 2 (R1, R4, R9)      → seed en un componente propio; disparador CLI (decisión propia del plan db/02)
Regla 4 (R3, R9, R15)     → reutilizar UsersService, ProjectsService y el flujo de importación exportados por sus módulos (apoya D2: NestFactory.createApplicationContext)
Regla 5 (R7, R11, R15)    → reset en orden: catalog_rows/jobs/snapshots y archivos → projects → app_users, solo filas marcadas
Regla 6 (R10, R13, R16)   → crear proyectos con ProjectsService.create e importar el CSV de ejemplo con el mismo servicio que la API (incremento 4)
Regla 7 (R11, R13, R14)   → usar los registros devueltos (ids) para encadenar usuario → proyecto → importación
Regla 9 (db/04 R16)       → abortar fuera de un destino permitido (incremento 2 del plan)
Regla 10 (F16)            → documentar db:seed en el README (incremento 6)
```
