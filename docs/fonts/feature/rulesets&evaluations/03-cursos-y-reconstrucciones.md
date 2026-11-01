# 03 — Cursos y reconstrucciones para rulesets y evaluations

Fecha de creación: 2026-10-31  
Estado: Nueve guías reconstruidas, renderizadas, verificadas e instaladas; plan sin escribir; feature no implementada.  
Tipo de fuente: transcripciones originales, guías derivadas y registro de herramientas.  
Origen: Fernando Herrera/DevTalles (`NestJS Backend Completo`, `Microservicios con NestJS`, `Testing en NestJS`); Maximilian (`Boost your JavaScript projects with TypeScript`, nombre que consta en la transcripción); `Código Limpio` y `Clean Architecture - Fundamentos` (título original «Aprende los conceptos fundamentales de la Arquitectura de Software»), cuyos instructores no constan en los metadatos.  
Fecha de consulta: 2026-10-31  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [recetas](reconstrucciones/recetas/), [salida verificada](reconstrucciones/salida-2026-10-31/).

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/`. Las rutas de la tabla son relativas a esa raíz.

## Necesidad y selección

La feature necesita: (1) recibir un mapeo y una lista **ordenada** de reglas de varios tipos en un solo body validado; (2) probar esos DTOs sin levantar Nest; (3) modelar los tipos de regla para que el motor decida por su tipo; (4) un motor de reglas determinista y sin efectos sobre la entrada (RNF02). Se buscó con `search_transcripts.py` (resultados por sección) y después se inventariaron por título y contenido los cursos que el proyecto ya usa. Se leyeron completos los originales seleccionados y el contexto previo mínimo.

`NestJS Backend Completo` no enseña `@ValidateNested`; la búsqueda en todo `NestJS/` lo encontró en `Microservicios con NestJS` del mismo instructor, ya citado por el proyecto ([db/04](../../db/04-curso-nest-graphql-reconstrucciones.md)). Ningún curso local enseña un discriminador de class-transformer, perfiles de Google ni almacenamiento ordenado en `jsonb`: esos vacíos se cubren en la [ficha 02](02-fuentes-tecnicas.md).

## Fuentes primarias y guías derivadas

| ID | Original (sección, líneas) | Guía instalada y mecanismo recuperado | Necesidad |
| --- | --- | --- | --- |
| C1 / RC1 | `NestJS/NestJS Backend Completo/Sección 10 TypeORM - Postgres/124. Create Product DTO.md`, l. 15–35; contexto 134 l. 31 | [124 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 10 TypeORM - Postgres/124. Create Product DTO - Reconstrucción guiada.md>). `ValidationPipe` global, `@IsOptional`, `@IsString({ each: true })`, `@IsIn([...])`. [Receta](reconstrucciones/recetas/backend/124-create-product-dto.json). | Campos escalares de cada regla y lista cerrada de valores. |
| C2 / RC2 | `NestJS/Microservicios con NestJS/Sección 7 Order Details - Maestro detalle/69. DTOs de creación de orden.md`, l. 15–45 | [69 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Microservicios con NestJS/Sección 7 Order Details - Maestro detalle/69. DTOs de creación de orden - Reconstrucción guiada.md>). `@IsArray`, `@ArrayMinSize(1)`, `@ValidateNested({ each: true })`, `@Type(() => OrderItemDto)`, errores `items.0.*`. [Receta](reconstrucciones/recetas/microservicios/69-dtos-creacion-orden.json). | Body con `rules[]` y `mapping[]` de objetos validados uno a uno. |
| C3 / RC3 | `NestJS/Testing en NestJS/Sección 3 Nuestras primeras pruebas/18. Class Transformer - Pruebas de conversión de tipo.md`, l. 13–33; contexto 13 l. 17–23 y 16 l. 25 | [18 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 3 Nuestras primeras pruebas/18. Class Transformer - Pruebas de conversión de tipo - Reconstrucción guiada.md>). `validate()` no ejecuta `@Type`; `plainToInstance` + `validate` reproduce lo que hace Nest. [Receta](reconstrucciones/recetas/testing/18-class-transformer-conversion.json). | Probar DTOs anidados/polimórficos: sin `plainToInstance` las reglas hijas no se validan. |
| C4 / RC4 | `…/Testing en NestJS/Sección 3…/19. Test - Create.dto.md`, l. 13–37 | [19 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 3 Nuestras primeras pruebas/19. Test - Create.dto - Reconstrucción guiada.md>). Caso válido mínimo y `errors.find(e => e.property === …)` en vez de `errors[0]`. [Receta](reconstrucciones/recetas/testing/19-test-create-dto.json). | Pruebas robustas por regla y por campo. |
| C5 / RC5 | `…/Testing en NestJS/Sección 3…/20. Otras pruebas sobre Create y Update Dtos.md`, l. 13–43 | [20 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 3 Nuestras primeras pruebas/20. Otras pruebas sobre Create y Update Dtos - Reconstrucción guiada.md>). `constraints` con `toEqual`, `each` en ambos sentidos, `toBeUndefined`, probar solo lo propio del DTO derivado. [Receta](reconstrucciones/recetas/testing/20-otras-pruebas-create-update.json). | Comprobar la regla concreta que falla. |
| C6 / RC6 | `TypeScript/Boost your JavaScript projects…/Sección 7 Advanced Types/91. Discriminated Unions.md`, l. 13–23; contexto 90 l. 13–21 | [91 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/91. Discriminated Unions - Reconstrucción guiada.md>). Propiedad común `type` con literal distinto y narrowing por su valor. [Receta](reconstrucciones/recetas/typescript/91-discriminated-unions.json). | Tipo de dominio `Rule = CleanTextRule \| BuildTitleRule \| ExcludeRule`. |
| C7 / RC7 | `Arquitectura/Clean Architecture - Fundamentos/Sección 4 Paradigma Funcional/29. Función Pura.md`, l. 13–35 (C#) | [29 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Clean Architecture - Fundamentos/Sección 4 Paradigma Funcional/29. Función Pura - Reconstrucción guiada.md>). Determinismo recibiendo lo variable por parámetro; devolver objetos nuevos. [Receta](reconstrucciones/recetas/clean-architecture/29-funcion-pura.json). | Motor reproducible (RNF02) que no modifica filas originales. |
| C8 / RC8 | `…/Clean Architecture - Fundamentos/Sección 4…/34. Función de orden superior.md`, l. 13–25 (C#) | [34 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Clean Architecture - Fundamentos/Sección 4 Paradigma Funcional/34. Función de orden superior - Reconstrucción guiada.md>). `Filter(list, Func<int,bool>)`: recorrido fijo, condición recibida. [Receta](reconstrucciones/recetas/clean-architecture/34-funcion-orden-superior.json). | Recorrer filas una vez aplicando reglas recibidas. |
| C9 / RC9 | `…/Clean Architecture - Fundamentos/Sección 4…/35. Tipo Predicate.md`, l. 13–17 (C#) | [35 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Clean Architecture - Fundamentos/Sección 4 Paradigma Funcional/35. Tipo Predicate - Reconstrucción guiada.md>). `Predicate<int>` con nombre en lugar de `Func<int,bool>` en línea. [Receta](reconstrucciones/recetas/clean-architecture/35-tipo-predicate.json). | La regla «excluir por condición» es un predicado sobre la fila. |

### Contexto citado sin nueva guía

| ID | Original y líneas | Evidencia y uso |
| --- | --- | --- |
| C10 | `Arquitectura/Código Limpio/Sección 6 Objects, Classes & Data Containers Structures/86. The Open-Closed Principle (OCP) & Why It Matters.md`, l. 15–21 | Una clase `Printer` que crece con cada formato «violates the open-closed principle»; la alternativa son clases pequeñas que implementan una interfaz. La clase usa una clase ficticia sin código, por eso no se reconstruye. Argumento para un manejador por tipo de regla en lugar de un `switch` que crece. |
| C11 | `Arquitectura/Clean Architecture - Fundamentos/Sección 5 Principios SOLID/38. Principio de abierto cerrado (Open closed principle).md`, l. 13–15 y 27 | «abierto para extensión, pero … cerrado para su modificación»; añadir un `switch case` modifica la clase. El código depende de clases de lecciones 36–37 (`BigData`, repositorio de cervezas), por lo que no se reconstruyó sin ese contexto. Mismo uso que C10. |
| C12 | `NestJS/Microservicios con NestJS/Sección 10 Pagos - Payments Microservice/109. Payment Session DTO.md`, l. 23–25 y 39 | Repite `@ArrayMinSize` + `@ValidateNested({ each: true })` + `@Type` (confirma C2) y convierte `price` con `Math.round(item.price * 100)`. Ese redondeo de `number` es justo lo que RNF04 descarta para precios: se cita como contraste, no como mecanismo. |
| C13 | `NestJS/Testing en NestJS/Sección 3 Nuestras primeras pruebas/16. Test - Pagination.dto.md`, l. 31 | El `ValidationError` tiene `children` «por si acaso hay objetos anidados». Los errores de una regla concreta estarán en `children`, no en el primer nivel. |
| C14 | `Código Limpio/Sección 5 Control Structures & Errors/69. Extracting Validation Code.md`, l. 15–21 | Extraer `validateTransactions`/`validateTransaction` para separar validación de procesamiento. Orientación de legibilidad para el motor, alineada con la skill de código legible del proyecto. |

Guías ya existentes que la feature reutilizará sin regenerarlas: 93. Type Predicates (registrada en [types/02](../../types/02-legibilidad-common-http.md)) y las demás de TypeScript de [types/](../../types/), las de testing E2E/controlador 51 y 80 ([config/02](../../config/02-reconstrucciones-verificadas-testing.md)) y la paginación de la [feature anterior](../projects&catalog-import/06-paginacion-y-limites.md).

## Diferencia entre evidencia y adaptación

| Evidencia del curso | Interpretación limitada | Posible uso (a decidir en el plan) |
| --- | --- | --- |
| RC2: `@ValidateNested({ each: true })` + `@Type(() => OrderItemDto)` con un solo tipo de elemento | Funciona para arreglos homogéneos. No enseña elegir la clase por un campo. | Combinar con el discriminador de F16 y la validación de `type` que exige F17. |
| RC3: `validate()` sin `plainToInstance` no aplica `@Type` | Una prueba de un DTO anidado con objetos planos daría falsos positivos o negativos. | Las pruebas unitarias de `CreateRulesetDto` deben usar `plainToInstance`. |
| RC4/RC5 + C13: buscar por `property`, revisar `constraints` | En anidados, el error de `rules[2].template` aparece en `children` del error `rules`. | Helper de prueba que recorra `children`; no depender de `errors[0]`. |
| RC6: unión discriminada por `type` | Es tipado estático; no valida datos de entrada. | Tipos de dominio de reglas separados de los DTOs de transporte. |
| RC7: función pura, tiempo por parámetro, no mutar la entrada | El ejemplo es C#; el principio es transferible. | `evaluate(rows, ruleset, profile)` sin `Date.now()`, sin acceso a base ni disco, devolviendo filas nuevas. |
| RC8/RC9: recorrido fijo y condición recibida | Filtra enteros; no encadena transformaciones ni produce problemas por fila. | Pipeline: cada regla recibe una fila y devuelve la fila transformada o una exclusión con motivo. |
| C10/C11: OCP | Recomendación de diseño, no un mecanismo de Nest. | Registro de manejadores por tipo; valorar su coste frente a un `switch` exhaustivo con `never` para solo tres reglas. |
| C12: `Math.round(price * 100)` | Correcto para el ejemplo de Stripe; usa `number` binario. | Descartado para RNF04: precios como texto decimal validado y moneda del proyecto. |

## Incertidumbres conservadas en las guías

- RC1: nombres de propiedades y valores de `gender` normalizados desde la pronunciación; opciones del `ValidationPipe` desde la clase 134.
- RC2: orden de decoradores y contenido previo del barril no visibles.
- RC3–RC5: títulos de pruebas normalizados; el mensaje de la constraint `min` es el de class-validator por defecto, no texto leído; `PartialType` desde `@nestjs/mapped-types` asumido.
- RC6: el archivo adjunto `guards.ts` no es visible; valores de ejemplo de `path` y `connectionUrl` son marcadores.
- RC7: fecha de ejemplo y segunda instancia `otherBeer` ensambladas; «Tumor»/«readline» normalizados a `Tomorrow`/`WriteLine`.
- RC8–RC9: nombres de listas normalizados; se omite el código de clases previas del mismo `Program.cs`.

## Ejecución real de reconstruir-cursos-con-scripts

Script: `/Users/benji/.claude/skills/reconstruir-cursos-con-scripts/scripts/reconstruction.py`.

| Paso | Resultado |
| --- | --- |
| Inventario | Ninguna de las nueve lecciones tenía guía previa en su sección. |
| `draft` | Esqueleto comprobado con la lección 124; recetas completadas a mano tras leer cada original con `nl -ba`. |
| `render` (primer intento) | 9 guías en 5 stagings; todas las frases y líneas validadas. Al leerlas, los bloques de fase salían como `text`: se añadió `language` a las fases y se renderizó de nuevo en un staging limpio. |
| `render` final | `rendered`: 1 + 1 + 3 + 1 + 3; `library_written: false`. Salida en [salida-2026-10-31](reconstrucciones/salida-2026-10-31/). |
| Lectura | Guías 69 y 29 leídas completas; las demás revisadas por estructura y bloques. |
| `verify` | 9 guías, 13 originales (incluido contexto), `writes: 0`, por curso. No compila ni prueba el código del curso. |
| `install` | 9 guías creadas junto a sus originales; `reused: 0`, `existing_guides_overwritten: 0`. |

## Resultado y pendiente

Las fuentes de cursos para el plan están preparadas. No se escribió el plan, ni código, migraciones o pruebas de la feature. El siguiente paso es redactar `docs/plans/feature/rulesets&evaluations/01-plan-…` a partir del [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md).
