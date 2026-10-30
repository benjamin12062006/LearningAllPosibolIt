# 01 — Curso de testing Nest de Fernando Herrera: fuentes para futuras features

Fecha de creación: 2026-10-25  
Tipo de fuente: transcripciones originales locales, página del curso y documentación oficial.  
Origen: Fernando Herrera/DevTalles; curso **NestJS + Testing: Pruebas unitarias y end to end (e2e)**.  
Fecha de consulta: 2026-10-25  
Relacionada con: [plan de configuración](../../plans/config/01-testing-nest-para-futuras-features.md), [reconstrucciones ejecutadas](02-reconstrucciones-verificadas-testing.md), [plan de features](../../plans/feature/projects&catalog-import/01-plan-projects-y-catalog-import.md).

## Identificación y búsqueda

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS`. Los originales usan como campo Curso el subtítulo «E2E, Unit Testing, Jest, Mocks, Spies, Coverage, Mock Implementation, Custom Injections, Supertest y mucho más». Su enlace `Fuente` pertenece al curso de Udemy identificado abajo; la carpeta, el subtítulo y el título comercial son referencias al mismo material, no tres cursos distintos.

En la preparación inicial se ejecutó `search_transcripts.py` de `buscar-aprendizaje-en-cursos` con consulta Nest/testing/TestingModule, se listaron originales y se leyeron las lecciones T1–T9. El inventario de `reconstruir-codigo-curso` confirmó la lección 26 y su sección. Las guías generadas se excluyeron como originales. En una ampliación del mismo día solicitada por el usuario se reconstruyeron las lecciones 80 y 51 mediante `reconstruir-cursos-con-scripts`, con recetas, render, lectura, verify e instalación. [Resultados y límites](02-reconstrucciones-verificadas-testing.md).

## Mapa de evidencia primaria

Las rutas de lecciones son absolutas para abrirlas en este equipo. Para trasladar la biblioteca, conservar la raíz anterior y el tramo sección/archivo exacto de cada fila. Las líneas son físicas de los Markdown consultados, no timestamps inventados.

| ID | Original y localizador | Evidencia y aplicación |
| --- | --- | --- |
| T0 | [Página del curso](https://www.udemy.com/course/nestjs-testing-e2e/), título, Created by y temario | Confirma autoría Fernando Herrera/DevTalles, Jest, mocks, Supertest y recorrido unitario/E2E. No acredita compatibilidad de sus paquetes con esta API. |
| T1 | [10. Testing Scripts y depuración en VSCode](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 3 Nuestras primeras pruebas/10. Testing Scripts y depuración en VSCode.md>), líneas 13–31 y 43; frases «test Watch» y «Coverage» | Ejecución, fallo, watch y cobertura. Adaptar los modos a scripts pnpm nuevos; conservar comandos actuales. |
| T2 | [26. Test - PokemonService.ts](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 4 Pruebas sobre módulos, controladores y servicios/26. Test - PokemonService.ts.md>), líneas 19–29 y 33–39; «preparación, el estímulo y la aserción» | Pruebas flexibles con datos preparados y resultados, y reconocimiento de dependencia de Internet en el ejemplo inicial. Adaptación: unitarios futuros sin red y casos de fallo explícitos. |
| T3 | [50. Configuraciones para e2e](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 6 E2E - End to end testing/50. Configuraciones para e2e.md>), líneas 13–19 y 27–37; «Supertest», «ruta crítica» | Peticiones HTTP, configuración y cobertura E2E separada. El porcentaje no sustituye comprobar el comportamiento crítico. |
| T4 | [31. SpyOn - mockImplementation](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 4 Pruebas sobre módulos, controladores y servicios/31. SpyOn - mockImplementation.md>), líneas 17–31; «sin llamar la función» | Sustituir la implementación del colaborador para aislar controlador y servicio. No simular el sujeto cuya lógica se pretende verificar. |
| T5 | [80. Test - Auth Controller](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 8 Unit Testing - Autenticación, controladores y strategies/80. Test - Auth Controller.md>), líneas 17–33; «Testing module», «Use value» | Montaje con Test/TestingModule, providers y mock de los métodos usados. Passport es parte de ese ejemplo; aquí la identidad procede de Descope. |
| T6 | [95. Test - ProductsService](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 9 Unit Testing - Productos y carga de archivos/95. Test - ProductsService.md>), líneas 19–43; «providers», «DataSource» | Resolver dependencias y dobles de repositorio/transacciones. El ejemplo usa TypeORM; aquí no se copiarán `getRepositoryToken` ni QueryRunner a Prisma. |
| T7 | [52. E2E - Post Con y sin body](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 6 E2E - End to end testing/52. E2E - Post Con y sin body.md>), líneas 13–19 y 25–37; «array containing» | Request HTTP, estado y errores con AAA; considerar presencia y cantidad si el orden no importa. Las respuestas de nuestra API se tipan/validan sin trasladar silenciamientos de tipos. |
| T8 | [117. E2E - Preparación carga de archivos](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 10 E2E - Pruebas de extremo a extremo/117. E2E - Preparación carga de archivos.md>), líneas 13–27; «Form Data», «Bad Request» | Preparación del flujo de archivos y caso sin archivo. Es carga de imágenes; adaptar a CSV, autenticación obligatoria y directorio temporal privado. Esta lección no demuestra por sí sola todos los casos de multipart. |
| T9 | [115. E2E - Rutas protegidas](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 10 E2E - Pruebas de extremo a extremo/115. E2E - Rutas protegidas.md>), líneas 17–29 y 33–35 | Casos sin token y con Authorization. El curso registra usuarios en su base y espera con timeout para renovar token; no trasladar esos detalles a Descope ni a los tests locales futuros. |
| T10 | [51. E2E - Post Crear pokemon](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 6 E2E - End to end testing/51. E2E - Post Crear pokemon.md>), líneas 19–37; «bootstrap», «Global Pipes» | El montaje desde AppModule no ejecuta main; es necesario configurar el pipe antes de init. La clase termina esperando 200 mientras ya obtiene 400. Reconstruida como R2, conservando esa continuación pendiente. |

T1–T10 fueron leídos. T5 y T10 tienen guías derivadas R1/R2 instaladas y verificadas; T3 aporta contexto previo de R2. Las otras clases siguen siendo fuentes consultadas sin guía creada en este incremento. T4 continúa como referencia para ampliar aislamiento con espías cuando sea necesario. Los metadatos no garantizan que estén disponibles todos los archivos/adjuntos del curso.

## Contraste oficial de mecanismos vigentes

| ID | Fuente y localizador | Hecho observado y límite |
| --- | --- | --- |
| N1 | [Nest: Testing](https://docs.nestjs.com/fundamentals/testing), Testing utilities y End-to-end testing | Expone `Test.createTestingModule`, sustitución de proveedores y creación de app de prueba. Sus utilidades son independientes del runner: usar Jest sigue la referencia elegida por el usuario. No se asume que la configuración de un proyecto recién generado coincide con esta API. |
| N2 | [Jest: ECMAScript Modules](https://jestjs.io/docs/ecmascript-modules), activación y Differences between ESM and CommonJS | Requiere una estrategia ESM coherente; `jest` se importa explícitamente desde `@jest/globals`. La página consultada indica versión 30.5 y soporte ESM experimental. La combinación exacta con TypeScript 6 se comprobará al implementar T0. |

## Adaptación y límites

Propuesta propia: incorporar Jest/@nestjs/testing/Supertest solo en `test/features/`, conservar Node para pruebas existentes, controlar la frontera Descope y usar PostgreSQL temporal en integración. Dobles tipados, fixtures nuevos, limpieza en hooks, no usar red y comprobar efectos negativos se concretan en el plan; no se atribuyen como citas literales del instructor.

El código actual aporta un punto de atención adicional: [PrismaModule](../../../src/database/prisma.module.ts) registra una factory bajo `POSTGRESQL_CONNECTION`; [PrismaService](../../../src/database/prisma.service.ts) recibe ese pool y cierra recursos. En una app de prueba con módulos reales debe sustituirse esa conexión antes de compilar, no únicamente el cliente, para evitar arrancar Cloud SQL. El [guard real](../../../src/auth/descope-session.guard.ts) depende de `DescopeService.validateSession`, frontera útil para controlar identidades sintéticas sin desactivar autorización.

La preparación inicial no generó guías. La ampliación posterior sí produjo R1/R2 mediante la herramienta obligatoria y conserva sus [recetas/manifiesto](02-reconstrucciones-verificadas-testing.md). No se instalaron paquetes de testing, ejecutaron tests de la aplicación o midieron mejoras. «Más corto» se evaluará por preparación compartida pequeña y lectura clara, conservando cobertura de acceso, persistencia y fallos.
