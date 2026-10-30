# 02 — Ejecución de reconstrucciones y mejora del plan de testing

Fecha de creación: 2026-10-25  
Estado: Dos guías generadas, revisadas, verificadas e instaladas; código del curso y tests de la API no ejecutados.  
Tipo de fuente: evidencia derivada, recetas revisadas y registro de ejecución de herramienta.  
Relacionada con: [fuentes primarias](01-curso-testing-fernando-herrera.md), [plan actualizado](../../plans/config/01-testing-nest-para-futuras-features.md), [manifiesto](reconstrucciones/salida-2026-10-25/manifest.json).

## Objetivo y alcance

Esta entrada conserva la preparación y los resultados del helper anteriores al código de la API. La ejecución posterior de los tests está en [implementación 03](03-implementacion-y-verificacion-testing.md) y [bitácora 10](../../../bitacora-construccion/settings/10-testing-nest-para-features.md).

El usuario solicita ejecutar `reconstruir-cursos-con-scripts` para mejorar el plan que antes solo consultaba transcripciones. Se seleccionan dos mecanismos que afectan al primer montaje de pruebas: inyección de un servicio controlado y configuración HTTP que no se hereda al importar AppModule. No se reconstruye el curso completo ni se añaden tests a la aplicación.

Se aplicó la [skill solicitada](/Users/benji/.agents/skills/reconstruir-cursos-con-scripts/SKILL.md), su formato de recetas y el estándar de salida de reconstrucción por lección. Se preserva la separación entre la guía del curso y las decisiones para nuestra API.

## Artefactos y procedencia

| ID | Original y guía instalada | Receta y alcance |
| --- | --- | --- |
| R1 | [Original 80](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 8 Unit Testing - Autenticación, controladores y strategies/80. Test - Auth Controller.md>) → [guía 80](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 8 Unit Testing - Autenticación, controladores y strategies/80. Test - Auth Controller - Reconstrucción guiada.md>) | [Receta](reconstrucciones/80-auth-controller.json). Tres fases: montaje incompleto, módulo Passport del ejemplo y resolución con `provide/useValue`. Ocho evidencias; código final del spec bajo las incertidumbres declaradas. |
| R2 | [Original 51](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 6 E2E - End to end testing/51. E2E - Post Crear pokemon.md>) → [guía 51](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 6 E2E - End to end testing/51. E2E - Post Crear pokemon - Reconstrucción guiada.md>) | [Receta](reconstrucciones/51-post-crear-pokemon.json). Tres fases: montaje desde AppModule, POST sin body y restauración del pipe. Diez evidencias, incluida la [lección 50](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 6 E2E - End to end testing/50. Configuraciones para e2e.md>) como contexto. |

La lectura mínima adicional contrastó las lecciones 30/31 para entender el límite de aislamiento y la 14 para comprobar qué información de fixtures se recuperaba. No se generaron guías de esas lecciones ni se inventó un fixture a partir de datos ausentes. Su contenido no se incorporó como código a R1/R2.

## Ejecución realmente realizada

Script utilizado: `/Users/benji/.agents/skills/reconstruir-cursos-con-scripts/scripts/reconstruction.py`.

Raíz de curso: `/Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS`.

| Paso | Resultado observado |
| --- | --- |
| Inventario de las lecciones 80 y 51 | Originales numerados y metadatos confirmados; sin guías previas encontradas en el curso. |
| `draft`, una vez por original | Dos JSON nuevos en `reconstrucciones/`, inicialmente en estado draft. |
| Revisión y edición de recetas | Lectura completa de originales/contexto, frases por línea, certeza, fases y spec final. Estado ready después de revisión semántica. |
| `render` con ambas recetas y fecha 2026-10-25 | `rendered: 2`, `library_written: false`; valida frases por línea, referencias y estructura antes de generar la salida nueva en `reconstrucciones/salida-2026-10-25/`. |
| Lectura de ambos Markdown generados | Contraste de fases y código final con los pasajes originales; las dos guías declaran lo no recuperable. |
| `verify` | `verified: 2`, `originals: 3`, `writes: 0`. Confirma que los originales y las salidas siguen coincidiendo con las huellas del manifiesto; no vuelve a inferir semántica del código. |
| `install` con el mismo manifiesto | Dos guías creadas junto a sus originales; cero guías previas sobrescritas. Escritura fuera del workspace ejecutada con elevación aprobada. |

Las recetas y el manifiesto se conservan para poder repetir la revisión. La salida de staging es un artefacto verificable; los enlaces de transcripción que genera el helper están pensados para la guía instalada junto al original. Abrir las guías instaladas desde la tabla R1/R2, no usar las copias de staging como ubicación de estudio.

Después de actualizar el plan se repitió `verify` con el mismo resultado; se compararon las huellas de las dos guías instaladas con el manifiesto y ambas coinciden. La revisión de enlaces de los tres documentos de configuración y las dos guías resolvió 45 enlaces locales sin destinos ausentes, interpretando los enlaces de las copias de staging desde su ubicación instalada.

## Límites descubiertos y mejora aplicada

R1 confirma que el montaje del contenedor y una prueba del comportamiento son evidencias distintas. La clase finaliza con `toBeDefined`, no con un caso de login o permisos. Además, su mock está en ámbito de archivo; crear un módulo nuevo no borra el historial de ese objeto. Nuestro plan exige probar que se usa el doble y preparar mocks nuevos por caso.

R1 no permite recuperar con certeza la grafía del método verbal Checkstatus. La guía marca `checkAuthStatus` como reconstrucción pendiente de cotejo. Esto no bloquea el mecanismo `provide/useValue`, pero impide copiar ese spec como si fuese la réplica exacta de un repositorio completo. Passport tampoco se traslada a la API Descope.

R2 conserva el estado final rojo de la clase 51: `.expect(200)` mientras la respuesta ya es 400. La clase siguiente continúa la aserción. El ejemplo acredita el mecanismo de configurar la app de prueba; no acredita una suite final aprobada. Nuestro primer caso HTTP con sesión válida y body inválido esperará el 400 definido por contrato.

R2 no recupera las opciones exactas del `ValidationPipe` del curso; su código conserva únicamente la instancia mínima identificable y declara la carencia. Para nuestra API se usarán las opciones reales de `src/main.ts`, prefijo y versionado antes de `init()`, con regresión si se extrae una función compartida.

El [plan actualizado](../../plans/config/01-testing-nest-para-futuras-features.md) añade la tabla fuente/guía/decisión y ocho primeros casos ordenados con preparación y criterio de cierre. Las reglas sobre PostgreSQL temporal, Descope controlado, ESM, limpieza de recursos y tests actuales intactos se mantienen como adaptaciones del proyecto.

## Lo que esta verificación no demuestra

El helper valida la procedencia y los artefactos Markdown; no entiende el código ni demuestra compatibilidad con Nest/TypeScript actuales. No se compiló el curso, no se ejecutaron las pruebas descritas en las guías y no se instalaron Jest/Supertest en la API. La primera implementación sigue siendo T0 del plan y debe verificar versiones, metadatos, uso del doble y cierre de recursos antes de extender las suites.
