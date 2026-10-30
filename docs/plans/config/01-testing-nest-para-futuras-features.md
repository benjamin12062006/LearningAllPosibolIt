# 01 — Configurar testing Nest para las futuras features

Fecha de creación: 2026-10-25  
Última actualización: 2026-10-26  
Estado: T0/T1/T2 implementados y verificados localmente para projects e importación. Reconstrucciones reutilizadas según cada incremento.  
Ámbito: configuración de desarrollo y pruebas futuras de `projects`, `catalog-import` y siguientes features de la API.  
Relacionada con: [curso y evidencia consultada](../../fonts/config/01-curso-testing-fernando-herrera.md), [ejecución de la skill y resultados](../../fonts/config/02-reconstrucciones-verificadas-testing.md), [plan de features](../feature/projects&catalog-import/01-plan-projects-y-catalog-import.md), [projects](../feature/projects&catalog-import/02-plan-projects.md), [catalog-import](../feature/projects&catalog-import/03-plan-catalog-import.md).  
Revisión de referencia: API HEAD `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales anteriores. Se inspeccionaron de nuevo `package.json`, `tsconfig.json`, guards y soporte de pruebas en esta fecha.

## Objetivo y alcance solicitado

Crear una base de pruebas fácil de aprender y mantener siguiendo **NestJS + Testing: Pruebas unitarias y end to end (e2e)**, de Fernando Herrera/DevTalles, disponible localmente como `Testing en NestJS`. Cada nueva prueba debe describir un comportamiento, preparar solo sus dependencias y dar un fallo comprensible. [T0–T8](../../fonts/config/01-curso-testing-fernando-herrera.md).

El usuario limita la adopción de Jest a testing futuro: usuarios y conexión conservan sus archivos `.test.mjs`, runner `node:test` y helpers. Durante la ejecución pidió retirar toda la compatibilidad de espacios. Se eliminaron su suite, peticiones y comando; el test de wiring anterior conserva solo usuarios. La suite nueva de projects cubre la API vigente. Este cambio sustituye la propuesta inicial de fachadas; no convierte el resto de tests a Jest.

`docs/plans/config/` representa la configuración de herramientas del proyecto. No añade una nueva capa de negocio ni exige crear ahora un módulo `Config` de producción.

## Qué aporta cada herramienta

| Herramienta elegida | Función en las pruebas futuras | Procedencia |
| --- | --- | --- |
| Jest | Ejecutar casos, comparar resultados y controlar dobles/espías. | Curso: lecciones 10, 31 y 80. |
| `@nestjs/testing` | Crear un `TestingModule` con el componente real y dependencias pequeñas mediante `provide/useValue`; probar composición y reemplazar proveedores. | Curso: lecciones 80 y 95; documentación Nest N1. |
| Supertest | Hacer peticiones HTTP al servidor de la aplicación de prueba; comprobar DTOs, guards, estados y multipart. | Curso: lecciones 50, 52 y 117. |
| PostgreSQL temporal y Prisma | Verificar SQL, migraciones y restricciones reales en integración. Reutilizar el mecanismo PGlite/socket existente mediante un soporte nuevo acotado. | Adaptación del proyecto; el curso usa otros mecanismos de persistencia. |

Nest proporciona montaje e inyección; Jest ejecuta y compara; Supertest ejercita HTTP. La seguridad y el mantenimiento dependen de qué se comprueba y de aislar los recursos, no de instalar una librería.

## Punto de partida y compatibilidad

En el punto de partida no había `@nestjs/testing`, Jest ni Supertest entre las dependencias directas. La API usa Nest 12.0.3, TypeScript 6.0.2, Node 24, ESM (`type: module`), resolución `nodenext`, imports `.js` y metadatos de decoradores. Las versiones y configuraciones del vídeo no constituyen por sí solas una combinación probada en este árbol.

El incremento T0 verificará una combinación compatible antes de ampliarla: `@nestjs/testing` alineado con la versión de Nest instalada, Jest y tipos coherentes, Supertest y tipos, y una estrategia de transformación/compilación TypeScript que conserve ESM y metadatos de inyección. Comprobar peer dependencies de cualquier transformador; si no soporta TypeScript 6, evaluar compilación previa a un directorio exclusivo de tests con TypeScript antes de introducir otra herramienta. No bajar versiones globales ni cambiar el runtime a CommonJS para copiar el ejemplo.

La documentación de Jest describe requisitos propios de ESM, incluido importar `jest` desde `@jest/globals` y emitir ESM con el transformador. N1/N2 respaldan los mecanismos, pero la configuración exacta y sus posibles flags se fijarán tras el ensayo. Se probará la resolución real de imports `.js` y la disponibilidad de `design:paramtypes`; no usar un reemplazo global de extensiones que oculte errores de módulos. [Fuentes oficiales](../../fonts/config/01-curso-testing-fernando-herrera.md).

## Flujo obligatorio desde las lecciones

Aplicar [reconstruir-codigo-curso](/Users/benji/.agents/skills/reconstruir-codigo-curso/SKILL.md) antes de trasladar código de una lección a una prueba nueva:

1. Elegir una lección original concreta de la ruta T1–T8 de la ficha. Usar el inventario de la sección para confirmar número y archivo, y leer el original completo; recuperar solo el contexto previo necesario.
2. Reutilizar su guía existente si es fiel. Cuando se necesite una nueva, reconstruir cada cambio con evidencias E1/E2, líneas o frases recuperables y certeza explícita. Una lección produce una guía independiente.
3. Seguir obligatoriamente [reconstruir-cursos-con-scripts](/Users/benji/.agents/skills/reconstruir-cursos-con-scripts/SKILL.md): `draft` → receta revisada → `render` en staging nuevo → leer y contrastar Markdown → `verify` → `install` junto al original. No escribir la guía manualmente ni reemplazar el helper con otro generador.
4. Conservar en la guía el ejemplo de Fernando, con sus nombres y contexto. Adjuntos no disponibles o código no recuperable se declaran; no rellenar huecos con una implementación inventada. La guía no cambia código de esta API.
5. Adaptar después, en el proyecto: Pokémon/productos → proyectos/importación; TypeORM → repositorios Prisma; autenticación del curso → Descope. Registrar qué procede del instructor y qué es decisión nuestra.
6. Registrar la cadena `necesidad → original/pasaje → guía/fase → adaptación → archivo de test → comprobación real` en la bitácora del incremento. `verify` de la guía valida procedencia y Markdown; ejecutar Jest/Nest valida el test de la aplicación.

La preparación inicial solo leyó originales. Tras la petición de ejecutar la skill, se completaron `draft`, revisión de recetas, `render`, lectura/contraste de ambas guías, `verify` e `install` para las lecciones 80 y 51. Las guías se guardaron junto a sus originales; recetas y manifiesto quedan en el proyecto. [Registro de ejecución](../../fonts/config/02-reconstrucciones-verificadas-testing.md). Esta verificación no instaló Jest ni ejecutó tests de la API.

## Resultado de la reconstrucción y efecto en el plan

| Guía derivada y evidencia | Qué se recuperó | Decisión concreta para nuestra suite futura |
| --- | --- | --- |
| [R1 — 80. Test - Auth Controller](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 8 Unit Testing - Autenticación, controladores y strategies/80. Test - Auth Controller - Reconstrucción guiada.md>), fases 1–3, E1–E8 | Montaje por `controllers`, dependencia en `imports`, `provide/useValue`, `compile` y `module.get`. El único caso terminado comprueba que el controlador está definido. | Usar ese mecanismo para resolver colaboradores; T0 exige además que el componente use el doble y devuelva el resultado controlado. Un caso `toBeDefined` aislado no cierra la aceptación de una feature. |
| R1, código final y límites | El mock se conserva en ámbito de archivo; el `beforeEach` del módulo no reinicia sus llamadas. Passport pertenece al ejemplo del curso y el nombre exacto del método Checkstatus queda incierto. | Crear mocks nuevos dentro de la preparación por caso; no copiar Passport ni el método incierto a nuestra API. El servicio real de identidad sigue siendo Descope. No ampliar dependencias para reproducir la aplicación del curso. |
| [R2 — 51. E2E - Post Crear pokemon](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 6 E2E - End to end testing/51. E2E - Post Crear pokemon - Reconstrucción guiada.md>), fases 1–3, E3–E8 | `AppModule` no ejecuta el bootstrap. Añadir `ValidationPipe` cambia el fallo HTTP de 500 a 400; al cerrar esa clase todavía queda `.expect(200)`. | La preparación HTTP debe aplicar explícitamente la configuración de nuestra app antes de `init()`. El primer caso de DTO usará sesión sintética válida, body ausente y expectativa contractual 400. No copiar el estado rojo como test acabado. |
| R2, estado inicial y certeza | No se recuperan las opciones exactas del pipe ni todas las fuentes de la aplicación del curso. | Obtener transform/whitelist/forbidNonWhitelisted, prefijo y versionado del `main.ts` actual de esta API; no inferirlos del vídeo. La guía no acredita ejecución ni compatibilidad de versiones. |

La evidencia primaria sigue siendo cada transcripción enlazada en R1/R2 y la ficha T5/T10. El generador comprueba frases, estructura y huellas; el contraste del agente justifica la interpretación. No sustituye a Jest, a TypeScript ni a una prueba de seguridad.

## Organización propuesta

```text
test/
├── *.test.mjs                         # pruebas actuales, conservadas
└── features/                         # nueva suite Jest, al implementar
    ├── support/                      # recursos y fixtures realmente compartidos
    ├── projects/
    │   ├── projects.service.spec.ts
    │   ├── projects.repository.int-spec.ts
    │   └── projects.e2e-spec.ts
    └── catalog-import/
        ├── csv-parser.spec.ts
        ├── catalog-import.service.spec.ts
        ├── catalog-import.repository.int-spec.ts
        └── catalog-import.e2e-spec.ts
```

Es un destino documental: crear cada archivo cuando exista el comportamiento que verifica. Añadir spec unitario de controller solo si tiene decisiones propias que no estén cubiertas por HTTP. No duplicar toda la suite para cada capa.

Configuraciones separadas por suite, con una base común pequeña si hay repetición real: `unit`, `integration` y `e2e`. Todas limitan discovery a `test/features/` y excluyen los `.test.mjs` actuales, salidas compiladas y cobertura. Mantener los tipos Jest en un `tsconfig` de pruebas; no añadir globales Jest al código productivo o a las pruebas Node. Separar los directorios de cobertura.

Scripts implementados: `test:features:unit`, `test:features:integration`, `test:features:e2e`, `test:features:watch`, `test:features:cov` y `test:features` para ejecución conjunta. Son adaptación a pnpm de los modos del curso. La tarea combinada devuelve error si cualquiera falla y solo migra bases temporales locales. Los comandos anteriores de usuarios y conexión se conservan; `spaces:verify` se retiró por el cambio solicitado.

## Pruebas cortas y mantenibles

- Un comportamiento por caso, nombre concreto en español y tres momentos visibles: preparación, ejecución y comprobación. Ejemplo de intención: «rechaza importar un proyecto ajeno y no guarda el archivo».
- El servicio bajo prueba es real; simular únicamente colaboradores. Usar `useValue` y dobles tipados de los métodos utilizados (`Pick`/`jest.Mocked` cuando proceda), sin `as any` ni un mock gigante de Prisma para cada test.
- Crear dobles y fixtures nuevos por caso para no compartir estado. Usar fábricas pequeñas como `projectFixture(overrides)` cuando varias pruebas necesiten el mismo dato; no ocultar en ellas llamadas, aserciones ni reglas de negocio.
- Preparar el `TestingModule` una vez por caso unitario cuando su estado pueda cambiar; conservar su referencia y cerrar recursos al terminar. En integración/HTTP, compartir arranque por suite solo si hay aislamiento de datos por caso.
- Esperar las promesas y los errores asíncronos. Para efectos importantes comprobar resultado y efecto: proyecto ajeno → error, sin escritura/archivo/job. No exigir el orden de llamadas internas salvo que forme parte del contrato.
- Usar comparaciones parciales para campos irrelevantes y exactas para propietario, estado, IDs y conteos críticos. `arrayContaining` no basta cuando deben coincidir cantidad, duplicados u orden; añadir la comprobación pertinente. La flexibilidad del matcher no debe permitir fugas de datos.
- Agrupar variantes de validación con casos parametrizados cuando mejore la lectura; mantener separados los escenarios con preparación o efectos diferentes. No imponer un número máximo de líneas ni un porcentaje de cobertura que obligue a esconder código.
- Controlar reloj/UUID a través de dependencias pequeñas cuando sean parte del comportamiento. Para jobs, esperar su finalización observable con timeout acotado; evitar sleeps fijos o reintentos que tapen fallos. No usar temporizadores simulados alrededor de Prisma/socket sin un motivo comprobado.

Estas son reglas propias adaptadas de AAA, mocks y pruebas flexibles de T2–T6; no todas son instrucciones literales del curso. Se enseñarán al escribir cada primer caso, sin exigir que el usuario sea experto en QA.

## Qué probar con recursos reales y qué aislar

| Tipo | Sujeto y colaboradores | Aceptación prioritaria |
| --- | --- | --- |
| Unitario `projects` | Servicio real, usuario/repositorio controlados. | Propietario derivado de identidad, configuración pendiente/completa, denegación sin escritura. |
| Unitario `catalog-import` | Parser real en sus casos; coordinación con almacenamiento/repositorio controlados en otros. | Ceros iniciales, cabeceras/IDs inválidos, límites, finalización/fallo. No simular el propio parser para afirmar que parsea bien. |
| Integración de repositorio | Prisma/pg y migraciones sobre PostgreSQL temporal. | Conservación de datos heredados, unicidad, FK, aislamiento SQL y transacciones. Un mock no demuestra rollback real. |
| HTTP con Nest/Supertest | Controllers, pipes, guards, servicios, repositorios y base temporal; frontera del proveedor Descope controlada. | `401/404/409/413`, POST/PATCH, multipart, `202` → estado/snapshot y rechazo de campos extra. |
| Integración externa posterior | Proveedor Descope real y entorno expresamente preparado. | Login con token real; independiente de la suite local rutinaria. |

En HTTP se mantiene **`DescopeSessionGuard` real**. Reemplazar `DescopeService.validateSession` mediante `overrideProvider` con identidades sintéticas Alice/Bob y fallo para token inválido; probar también header ausente. Así se ejercitan extracción de identidad y autorización sin hacer llamadas al proveedor. No usar un guard «siempre true» en casos que afirman probar acceso. Estas pruebas no acreditan verificación criptográfica ni login real de Descope.

La app de prueba debe reproducir prefijo `/api/v1`, versionado y `ValidationPipe` actuales. Valorar extraer una función pequeña de configuración compartida solo al implementar las rutas y si evita deriva; esa extracción conservará el comportamiento y tendrá regresión. No reconstruir manualmente toda la app en cada spec.

Al importar módulos reales, reemplazar **también `POSTGRESQL_CONNECTION` antes de `compile()`**, no solo `PrismaService`: su factory actual crea la conexión Cloud SQL y podría ejecutarse durante montaje. Para integración, proporcionar pool temporal y reutilizar el PrismaService real; para unitarios, montar solo el componente y sus colaboradores. Asegurar una única responsabilidad de cierre de pool/cliente/app para evitar dobles cierres y recursos abiertos.

Cada suite de persistencia usa una base temporal propia y cada suite de archivos un directorio temporal propio con limpieza en `finally`/hooks. No leer `.env` de desarrollo ni usar Cloud SQL como destino de los tests. El arranque de la suite debe fallar si intenta resolver credenciales externas o un destino distinto al temporal. Probar ese aislamiento antes de introducir limpieza de filas. PGlite conserva su límite: no acredita concurrencia de varios procesos en Cloud SQL.

## Incrementos y criterio para avanzar

| Etapa | Entrega futura | Criterio de cierre |
| --- | --- | --- |
| T0 — Configuración mínima | Dependencias compatibles, discovery aislado, un módulo Nest pequeño con proveedor sustituido, compilación/tipos y scripts nuevos. | Un fallo deliberado hace fallar el comando; un pase lo cierra correctamente; los tests actuales siguen disponibles sin cambios. ESM y metadatos comprobados; ninguna conexión externa. |
| T1 — Projects | Reutilizar R1 para montaje/mocks; reconstruir otras lecciones cuando añadan un mecanismo necesario. Primer caso nominal y primer caso de acceso ajeno; después completar aceptación de la feature. | El usuario puede explicar preparación/ejecución/aserción; datos/efectos y regresión SQL cubiertos. |
| T2 — Catalog import | Parser con fixtures pequeños, error tras lote y API multipart con Nest real. | Un fallo no deja snapshot utilizable ni artefacto público; límites y aislamiento cubiertos. |
| T3 — Rutina de trabajo | Watch durante desarrollo, ejecución conjunta para cerrar incremento y cobertura por suite. | Fallos legibles y reproducibles, cierre limpio, bitácora con fuentes y comandos reales. |

T0 precede a las nuevas suites de features; no bloquea leer código o ejecutar los tests de regresión actuales. La documentación de cada incremento anotará versiones efectivas y cómo lanzar un caso individual. La cobertura se usa para localizar rutas críticas sin probar; la fuente T3 (lección 50) advierte que el porcentaje por sí solo no demuestra que esté probado lo importante.

## Primeros casos y preparación mínima de cada uno

| Orden | Caso futuro | Preparación necesaria | Comprobación que permite cerrarlo |
| --- | --- | --- | --- |
| 1, T0 | El contenedor inyecta y utiliza el proveedor sustituido. | Componente pequeño y real con una dependencia, doble nuevo y valor de retorno controlado; sin importar AppModule ni abrir base. | Valor obtenido desde el sujeto y llamada al doble; variar el valor y ver que cambia el resultado. Un constructor que no usa la dependencia no demuestra la inyección. |
| 2, P1 | Listar los proyectos del usuario autenticado. | Identidad Alice, usuario local y proyectos fixture; resolver usuario y consultar repositorio. | Se llama al repositorio con el ID local de Alice y se devuelve el resultado previsto. No aceptar un `ownerId` enviado por cliente. |
| 3, P1 | Un proyecto de Bob es inaccesible para Alice. | Identidades distintas, proyecto de Bob y repositorio que resuelve bajo el propietario autorizado. | `404` contractual y cero actualizaciones. Repetir mediante HTTP con datos reales en base temporal para verificar el filtro SQL. |
| 4, HTTP de P1 | Solicitud autenticada sin configuración obligatoria. | App con pipes/prefijo/versionado reales; sesión sintética válida de Alice. | `400` y sin nuevo proyecto. Probar `ownerId` extra como variante separada de validación. |
| 5, HTTP de P1 | Solicitud sin Bearer. | Guard real y ninguna identidad preinyectada. | `401`; proveedor externo, escritura y servicio de negocio no se invocan. No mezclar este escenario con el caso anterior de body inválido. |
| 6, C1 | Importar a un proyecto con configuración pendiente. | Alice propietaria, proyecto heredado y almacenamiento controlado. | `409 PROJECT_CONFIGURATION_REQUIRED`; no guardar archivo ni crear trabajo. |
| 7, C2 | CSV con ID `000123`. | Parser real y fixture UTF-8 mínimo. | Se conserva exactamente la cadena; el éxito no depende de un mock del parser. |
| 8, C2/C3 | Fallo después de guardar un lote. | Repositorio/almacenamiento con fallo controlado en coordinación y escenario de integración sobre DB temporal. | Estado fallido y ninguna muestra/lectura parcial utilizable. Comprobar la persistencia real separadamente del mock de coordinación. |

Compartir solo cuatro tipos de preparación cuando haya repetición: fábricas de datos nuevas por llamada; montaje de la aplicación HTTP; recurso de base temporal; directorio de archivos temporal. Las aserciones se mantienen visibles en el caso. El worker se activa únicamente en las suites que verifican procesamiento; HTTP de aceptación/polling controla de forma explícita si está detenido o se espera su resultado.

Antes de ampliar cada grupo, hacer fallar temporalmente una expectativa relevante y comprobar que el comando reporta el fallo; restaurarla antes de cerrar. Para datos, cambiar el resultado o efecto esperado, sin desactivar validaciones ni introducir acceso a bases externas. Ese ensayo es una adaptación de verificación, no código heredado de R1/R2.

## Evidencia de cierre futura

Verificar expresamente: prueba nueva aislada y suite completa; tipos de tests; compilación/lint del código; scripts actuales de regresión; ausencia de archivos de test en el build productivo; cero conexiones remotas durante ejecución; limpieza de app/pool/temporales y comportamiento al repetir. No usar `--passWithNoTests` como prueba de configuración ni `--forceExit` para ocultar recursos abiertos.

Registrar originales, guías creadas/reutilizadas y verificación del helper por separado de los resultados Jest/HTTP. Abrir una entrada en `bitacora-construccion/settings/` al implementar T0, siguiendo el próximo número disponible entonces; esta preparación no se presenta como instalación ni como tests ejecutados.

## Ejecución y continuación

Se completaron configuración, ESM/metadatos, inyección, mocks, recursos temporales y las tres suites de projects. La compilación previa usa TypeScript y genera Prisma sin cargar `.env`; limpia `.test-build` antes de compilar. `configureHttp` comparte la configuración efectiva del servidor. Versiones, cadena de evidencia y resultados: [fuente de implementación](../../fonts/config/03-implementacion-y-verificacion-testing.md) y [bitácora 10](../../../bitacora-construccion/settings/10-testing-nest-para-features.md).

T2 se ejecutó con CatalogImportModule: parser y almacenamiento reales, coordinación de aceptación, cierre del worker, integración SQL y multipart HTTP. La [bitácora de importación](../../../bitacora-construccion/feature/projects&catalog-import/03-implementar-catalog-import.md) registra el resultado y los límites; las siguientes features reutilizan esta base sin convertir las suites Node anteriores.
