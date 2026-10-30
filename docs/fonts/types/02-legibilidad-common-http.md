# 02 — Legibilidad humana de common/http

Fecha de creación: 2026-10-28
Tipo de fuente: Transcripciones originales, reconstrucción, código y criterio del usuario
Fecha de consulta: 2026-10-28
Relacionada con: [fuentes anteriores de tipos](01-tipos-derivados-y-codigos-de-error.md), [plan 02](../../plans/errors/02-legibilidad-common-http.md), [bitácora 02](../../../bitacora-construccion/types/02-legibilidad-common-http.md)
Revisión de partida: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con código nuevo en el índice y cambios previos conservados.

## Objetivo de la consulta

El usuario considera correcto el comportamiento actual y pide que sea más fácil
leerlo y mantenerlo. La conversación adjunta se leyó como contexto del requisito,
no como evidencia de haber ejecutado una implementación anterior. Los fragmentos
se contrastaron con los siete archivos actuales de `src/common/http` y sus tests.

La dificultad observada está en seguir decisiones encadenadas del filtro, las
comprobaciones de errores históricos y la combinación de recorrido, reglas y
ordenación en validación. La extensión del catálogo corresponde en su mayoría a
los 54 estados y traducciones; compactarlo no resuelve esas decisiones de flujo.

## Fuentes de arquitectura seleccionadas

Se ejecutó el buscador de cursos con `Clean Code SOLID responsabilidades legibilidad
nombres funciones`, tecnología Arquitectura. Se inventariaron en orden las tres
secciones indicadas por el usuario. Se leyeron completos estos siete originales,
sin seleccionar material LEGACY. Cada localizador es una línea física de la
transcripción, no un timestamp inventado.

### F1 — Nombres y lectura humana

Original: [12. Nombres pronunciables y expresivos](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Fundamentos de Arquitectura de Software/Sección 2 Clean Code y Deuda técnica/12. Nombres pronunciables y expresivos.md>).
Curso en metadatos: Fundamentos de la arquitectura y desarrollo de software.
Instructor: Fernando (mencionado por su nombre en la lección 50; apellido no identificado en estos originales).
Ruta relativa a la biblioteca: `Arquitectura/Fundamentos de Arquitectura de Software/Sección 2 Clean Code y Deuda técnica/12. Nombres pronunciables y expresivos.md`.
Pasajes consultados para esta decisión: líneas 15, 29–35 y 43.

**Evidencia e interpretación:** Nombres concretos para datos y operaciones; priorizar la lectura de quien mantiene el código.

### F2 — Intención de las funciones

Original: [16. Nombres de funciones, argumentos y parámetros](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Fundamentos de Arquitectura de Software/Sección 2 Clean Code y Deuda técnica/16. Nombres de funciones, argumentos y parámetros.md>).
Curso en metadatos: Fundamentos de la arquitectura y desarrollo de software.
Instructor: Fernando (mencionado por su nombre en la lección 50; apellido no identificado en estos originales).
Ruta relativa a la biblioteca: `Arquitectura/Fundamentos de Arquitectura de Software/Sección 2 Clean Code y Deuda técnica/16. Nombres de funciones, argumentos y parámetros.md`.
Pasajes consultados para esta decisión: líneas 13, 19 y 25–29.

**Evidencia e interpretación:** Una función debe hacer lo que su nombre dice; los argumentos deben permitir entender su uso.

### F3 — Flujo y retornos tempranos

Original: [18. Detalles adicionales sobre funciones](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Fundamentos de Arquitectura de Software/Sección 2 Clean Code y Deuda técnica/18. Detalles adicionales sobre funciones.md>).
Curso en metadatos: Fundamentos de la arquitectura y desarrollo de software.
Instructor: Fernando (mencionado por su nombre en la lección 50; apellido no identificado en estos originales).
Ruta relativa a la biblioteca: `Arquitectura/Fundamentos de Arquitectura de Software/Sección 2 Clean Code y Deuda técnica/18. Detalles adicionales sobre funciones.md`.
Pasajes consultados para esta decisión: líneas 13–19 y 29–41.

**Evidencia e interpretación:** Delegar pasos significativos y reducir anidación. El propio curso admite if o ternario según claridad.

### F4 — Responsabilidad única

Original: [47. Principios SOLID - SRP - Responsabilidad Única](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Fundamentos de Arquitectura de Software/Sección 5 Principios SOLID/47. Principios SOLID - SRP - Responsabilidad Única.md>).
Curso en metadatos: Fundamentos de la arquitectura y desarrollo de software.
Instructor: Fernando (mencionado por su nombre en la lección 50; apellido no identificado en estos originales).
Ruta relativa a la biblioteca: `Arquitectura/Fundamentos de Arquitectura de Software/Sección 5 Principios SOLID/47. Principios SOLID - SRP - Responsabilidad Única.md`.
Pasajes consultados para esta decisión: líneas 13–19.

**Evidencia e interpretación:** Agrupar procesos relacionados; SRP no significa una clase por método.

### F5 — Señales y límites de SRP

Original: [50. Detectar incumplimiento de SRP](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Fundamentos de Arquitectura de Software/Sección 5 Principios SOLID/50. Detectar incumplimiento de SRP.md>).
Curso en metadatos: Fundamentos de la arquitectura y desarrollo de software.
Instructor: Fernando (mencionado por su nombre en la lección 50; apellido no identificado en estos originales).
Ruta relativa a la biblioteca: `Arquitectura/Fundamentos de Arquitectura de Software/Sección 5 Principios SOLID/50. Detectar incumplimiento de SRP.md`.
Pasajes consultados para esta decisión: líneas 15–25.

**Evidencia e interpretación:** Nombres e imports son pistas contextuales, no límites numéricos para fraccionar el módulo.

### F6 — Dirección de dependencias

Original: [58. La Regla de Dependencia](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Clean Architecture - Fundamentos/Sección 8 Clean Architecture/58. La Regla de Dependencia.md>).
Curso en metadatos: Aprende los conceptos fundamentales de la Arquitectura de Software
Instructor: no identificado en los originales consultados.
Ruta relativa a la biblioteca: `Arquitectura/Clean Architecture - Fundamentos/Sección 8 Clean Architecture/58. La Regla de Dependencia.md`.
Pasajes consultados para esta decisión: líneas 13–19.

**Evidencia e interpretación:** Mantener traducción de errores en el adaptador; no importar features desde la base común.

### F7 — Responsabilidades sin árbol obligatorio

Original: [59. Aclaraciones sobre Clean Architecture](</Users/benji/Documents/chrome-extencions/trancripciones/Arquitectura/Clean Architecture - Fundamentos/Sección 8 Clean Architecture/59. Aclaraciones sobre Clean Architecture.md>).
Curso en metadatos: Aprende los conceptos fundamentales de la Arquitectura de Software
Instructor: no identificado en los originales consultados.
Ruta relativa a la biblioteca: `Arquitectura/Clean Architecture - Fundamentos/Sección 8 Clean Architecture/59. Aclaraciones sobre Clean Architecture.md`.
Pasajes consultados para esta decisión: líneas 13–25.

**Evidencia e interpretación:** Conservar las dependencias y responsabilidades, sin imponer carpetas o capas adicionales.

### Interpretación de las recomendaciones

F3 no ordena reducir cualquier función a una línea: en la línea 17 pide un balance
con la comprensión, y en la 41 ofrece if explícito como alternativa al ternario.
Por eso se elegirán condiciones directas para decisiones sucesivas. F4, línea 19,
explica que una responsabilidad puede contener varios procesos relacionados:
no se creará una clase o archivo por cada comprobación.

F6/F7 sirven para preservar la dirección de imports de la base común. No prueban
que este proyecto sea una implementación completa de Clean Architecture ni exigen
reorganizar el backend. Es una refactorización local del adaptador HTTP.

Las lecciones de arquitectura respaldan criterios de lectura y límites. No hace
falta reconstruir el ejercicio de correo, salarios ni sus adjuntos: no se adapta
su algoritmo y los originales conceptuales bastan para estas decisiones.

## F8 / R1 — Guard con nombre en TypeScript

Instructor: Maximilian Schwarzmüller, identificado por el usuario y por las
fuentes de la investigación anterior.
Curso: Boost your JavaScript projects with TypeScript: Learn all about core types,
generics, TypeScript + React or Node & more!

- **F8:** [93. Outsourcing Type Guards & Using Type Predicates](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/93. Outsourcing Type Guards & Using Type Predicates.md>), sección 7; líneas 13–19: extraer `isFile`, predicado e inferencia en `loadData`. Ruta relativa a la biblioteca: `TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/93. Outsourcing Type Guards & Using Type Predicates.md`.
- **R1:** [93. Outsourcing Type Guards & Using Type Predicates - Reconstrucción guiada](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/93. Outsourcing Type Guards & Using Type Predicates - Reconstrucción guiada.md>), fases 2–3, símbolos `isFile` y `loadData`. Se generó con la skill de scripts y se revisó; no se compiló el curso.
- **Contexto:** originales 90 y 91, leídos completos y registrados por hashes en el manifest. El adjunto de IO no está disponible; la guía declara ese esqueleto y no inventa apertura de archivos ni conexiones.

**Adaptación propia:** el backend recibe `unknown`, mientras el ejemplo de
Maximilian recibe una unión conocida. Un predicado con nombre solo resulta válido
si conserva las comprobaciones de objeto, presencia y tipos de campos necesarias.
Se usará para reconocer incidencias públicas válidas y filas positivas, evitando
aserciones de tipo que obliguen al lector a confiar sin ver la condición.

Las seis reconstrucciones anteriores sobre constantes y tipos siguen siendo
antecedentes; se conservan `ErrorCodes`, la unión de sus valores y `satisfies`.
No se regeneraron esas guías.

## F9 — Contraste oficial

[TypeScript Handbook — Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html),
apartados «Using type predicates» y «Control flow analysis». Consulta: 2026-10-28.
Un predicado expresa `parameterName is Type`; los retornos y condiciones permiten
estrechar tipos según el flujo. La comprobación de compatibilidad real se hará con
el compilador instalado. No se añade una API ni dependencia nueva de Nest/Express.

## Decisiones propuestas y alternativas

| Necesidad | Fuente → decisión propia | Coste y límite |
| --- | --- | --- |
| Entender el filtro de arriba abajo | F1/F2/F3 → nombrar lectura de excepción, resolución de código e incidencias | Helpers privados en el mismo archivo; el lector puede abrir el detalle sin recorrer módulos nuevos. |
| Entender JSONB histórico | F1/F3 + F8/R1 → separar contexto permitido y usar un predicado explícito para sourceRow | Se mantienen fallback, límites, valores vacíos y entradas históricas admitidas. |
| Reconocer errores técnicos | F2/F6 → switch sobre los tipos del parser, explicado como contrato Express | Se conserva el middleware y su orden: quitarlo cambiaría INVALID_JSON y otros códigos. |
| Entender validación | F2/F3/F4 → nombrar selección de código y comparación; recorrido visible | Se conserva recursión, deduplicación y orden por unidades de código; no localeCompare. |
| Comprender errores y datos | F1/F4/F7 → cuerpo de apiError con if explícito; catálogo y constantes conservados | No sustituir switch de clases Nest por dispatch dinámico ni comprimir traducciones. |

Se descartan librerías nuevas, wrappers genéricos, capas nuevas y un archivo por
cada if. También se descarta convertir todo a programación funcional encadenada:
filter/map/reduce no garantiza una lectura más sencilla para este mantenimiento.

El criterio de aceptación no es un porcentaje de reducción de líneas: es poder
seguir las decisiones por nombres y condiciones, con resultados comparados contra
la implementación inicial. La legibilidad para el usuario sigue teniendo una parte
subjetiva; la equivalencia de comportamiento sí se verificará con datos y tests.
