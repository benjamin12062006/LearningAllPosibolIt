# 07 — Legibilidad de los módulos: Clean Code, Clean Architecture y Nest

Fecha de creación: 2026-10-30
Tipo de fuente: transcripciones originales, una reconstrucción y fichas anteriores
Origen: Maximilian Schwarzmüller, *Clean Code* (carpeta `Arquitectura/Código Limpio`, Udemy `writing-clean-code`); Fernando, *Fundamentos de la arquitectura y desarrollo de software* (carpeta `Arquitectura/Fundamentos de Arquitectura de Software`); Fernando Herrera, *Nest: Desarrollo backend escalable con Node* (carpeta `NestJS/NestJS Backend Completo`).
Fecha de consulta: 2026-10-30
Relacionada con: [plan 05 de legibilidad](../../../plans/feature/projects&catalog-import/05-plan-legibilidad-modulos.md), [ficha types/02 (common/http)](../../types/02-legibilidad-common-http.md), [plan errors/02](../../../plans/errors/02-legibilidad-common-http.md).

## Necesidad de consulta

El usuario quiere que el código de `auth`, `users`, `projects`, `catalog-import` y `graphql` se pueda leer y mantener por personas, como ya se hizo con `src/common/http`: pasos con nombre, sin la máxima abstracción sintáctica y sin romper lo que funciona. La [ficha types/02](../../types/02-legibilidad-common-http.md) ya cubre nombres (F1, F2), retornos tempranos (F3), SRP (F4, F5), regla de dependencia (F6, F7) y predicados de tipo de TypeScript (F8/R1, F9). Faltaban criterios sobre el orden dentro de un archivo, cuándo extraer y cuándo no, condiciones en positivo, comentarios y cómo leer al usuario autenticado en Nest.

## Localización verificable

Búsqueda con `buscar-aprendizaje-en-cursos` («estructura de clases clean code», «comentarios clean code», «custom decorator GetUser», «DRY duplicación»). Se leyeron completas estas once lecciones; los localizadores son líneas físicas verificadas con `nl -ba`.

| ID | Curso · lección | Líneas | Idea |
| --- | --- | --- | --- |
| G1 | Clean Code · [31. Good Comments](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 3 Code Structure, Comments & Formatting/31. Good Comments.md>) | 15–17, 23 | Comentarios aceptables: lo que un nombre no puede explicar (una expresión regular) y advertencias. |
| G2 | Clean Code · [33. Vertical Formatting](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 3 Code Structure, Comments & Formatting/33. Vertical Formatting.md>) | 13, 21–29 | Leer de arriba abajo; líneas en blanco entre conceptos; los métodos que se llaman, cerca y debajo. |
| G3 | Clean Code · [49. Why Levels of Abstraction Matter](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 4 Functions & Methods/49. Why Levels of Abstraction Matter.md>) | 13–21, 27 | La función principal orquesta pasos; el código de bajo nivel va en funciones cuyo nombre lo explica. |
| G4 | Clean Code · [50. When Should You Split](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 4 Functions & Methods/50. When Should You Split.md>) | 15–17 | Extraer el código que exige más interpretación que el que lo rodea. |
| G5 | Clean Code · [54. Don't Overdo It](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 4 Functions & Methods/54. Don't Overdo It - Avoid Useless Extractions.md>) | 13–15, 23–27 | No extraer si solo se renombra la operación o cuesta encontrar un nombre; a veces conviene reestructurar con una clase. |
| G6 | Clean Code · [61. Introducing Guards](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 5 Control Structures & Errors/61. Introducing Guards.md>) | 13–17 | Guards: fallar pronto y evitar anidar. |
| G7 | Clean Code · [63. Extracting Control Structures & Preferring Positive Phrasing](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 5 Control Structures & Errors/63. Extracting Control Structures & Preferring Positive Phrasing.md>) | 13–15 | Sacar las condiciones a funciones con nombre en positivo (`isEmpty`). |
| G8 | Clean Code · [70. Error Handling Is One Thing!](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Código Limpio/Sección 5 Control Structures & Errors/70. Error Handling Is One Thing!.md>) | 13–17 | Un `try/catch` es una tarea: la función que lo tiene no debería hacer además otras cosas. |
| G9 | Fundamentos · [32. Estructura recomendada de una clase](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Fundamentos de Arquitectura de Software/Sección 3 Clean Code - Clases y Comentarios/32. Estructura recomendada de una clase.md>) | 15–23 | Todo el equipo ordena las clases igual: propiedades, constructor, métodos (públicos antes que privados según el lenguaje). |
| G10 | Fundamentos · [33. Comentarios en el código](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Fundamentos de Arquitectura de Software/Sección 3 Clean Code - Clases y Comentarios/33. Comentarios en el código.md>) | 17–23 | Priorizar al lector; comentar el porqué, no el qué ni el cómo. |
| G11 | Nest Backend Completo · [177. Custom Property Decorator - GetUser](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 13 Autenticación de autorización/177. Custom Property Decorator - GetUser.md>) | 15–21, 33–37 | Leer el usuario con un decorador de parámetro; si no está, es un 500 del backend. |

R1 — [reconstrucción de la lección 177](<reconstrucciones/legibilidad/salida-2026-10-30/Sección 13 Autenticación de autorización/177. Custom Property Decorator - GetUser - Reconstrucción guiada.md>). Receta en [reconstrucciones/legibilidad/recetas/177.json](reconstrucciones/legibilidad/recetas/177.json). `render`, `verify` (1 guía, 2 originales con huella) e `install` correctos; la guía también está junto a la transcripción. Es la única lección con código entre las nuevas. Las de Clean Code y Fundamentos son conceptuales y no se reconstruyeron: sus ejemplos (JavaScript genérico, transacciones de pago, almacenamiento en disco) no se adaptan al proyecto.

## Evidencia

- **Leer como un texto.** «Your code should be readable like an essay; top to bottom without too many "jumps"» (G2, l. 13). Las líneas en blanco separan conceptos y los métodos que se llaman entre sí quedan cerca (G2, l. 21–29). El orden fino depende de la guía de estilo del lenguaje (G2, l. 31) y debe ser el mismo en todo el equipo (G9, l. 15).
- **Orquestar y delegar.** «If a function is called saveUser, it should just orchestrate all the steps» (G3, l. 19). El código de bajo nivel no es malo; va donde el nombre de la función le da sentido (G3, l. 15–17). Extraer lo que pide más interpretación que su entorno (G4, l. 17).
- **No extraer de más.** No dividir si solo se renombra la operación, si encontrar el código extraído cuesta más o si no hay un buen nombre (G5, l. 15). Una función corta con niveles mezclados puede estar bien si se entiende (G3, l. 27).
- **Guards y positivo.** Invertir la condición y salir pronto evita anidar (G6, l. 15–17); los nombres en positivo se leen mejor: «it simply is easier to read if we use a positive statement» (G7, l. 15).
- **Errores.** Si una función tiene un `try/catch`, ese es su trabajo; validar, recorrer y capturar en la misma función son varias tareas (G8, l. 13–15).
- **Comentarios.** Comentar «el por qué» en lugar de «el qué» o «el cómo» (G10, l. 21–23). Valen las explicaciones que un nombre no puede dar, como una expresión regular, y las advertencias (G1, l. 15–17).
- **Usuario autenticado en Nest.** El instructor descarta leer `@Req()` en cada ruta y crea `GetUser` con `createParamDecorator` (G11, l. 19–21; R1). Si el usuario no está, lanza un 500 porque es un error del desarrollador del backend (G11, l. 35–37).

## Interpretación y límites

- Son criterios de lectura, no reglas numéricas. El propio Maximilian insiste en el sentido común (G5, l. 13); por eso el éxito no se mide en líneas.
- G9 describe un orden de clase genérico. En TypeScript con Nest se toma así: propiedades, constructor, métodos públicos en el orden en que se usan y privados debajo, cerca de quien los llama (G2).
- G11 usa Passport y `request.user`; el proyecto usa Descope y `request.authenticatedIdentity`, y ya tiene `CurrentIdentity` (con el mismo 500) solo en GraphQL. La lección justifica usarlo también en REST, no cambiar su contrato.
- Nada de esto pide capas nuevas: F6/F7 de la ficha types/02 siguen vigentes (sin carpetas por seguir un diagrama).

## Aplicación en el proyecto

La aplicación concreta, módulo por módulo, está en el [plan 05](../../../plans/feature/projects&catalog-import/05-plan-legibilidad-modulos.md). Resumen:

```text
G11 + R1              → @CurrentIdentity() en los controladores REST; se eliminan requireIdentity/identityOf duplicados
G3 + G4 + F8/R1       → condiciones con nombre: hasCompleteConfiguration (predicado), changesConfiguration, isActiveJob…
G3 + G8               → CatalogImportService.accept y CatalogImportWorker.consume leen como pasos; el manejo de errores en su propia función
G2 + G9               → orden uniforme: imports externos y luego del proyecto; método principal arriba y helpers debajo; SQL en varias líneas
G5                    → sin extracciones que solo renombran ni archivos o clases por condición; los nombres públicos y archivos no cambian
G10 + G1              → comentarios solo para el porqué (bloqueos FOR UPDATE, orden de borrado, expresiones regulares)
```
