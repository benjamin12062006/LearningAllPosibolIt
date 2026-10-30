# 01 — Tipos derivados para códigos de error

Fecha de creación: 2026-10-28
Tipo de fuente: Transcripciones originales, reconstrucciones derivadas, documentación oficial y código actual
Instructor: Maximilian Schwarzmüller (identificado por el usuario y en la lección 119)
Curso: Boost your JavaScript projects with TypeScript: Learn all about core types, generics, TypeScript + React or Node & more!
Fecha de consulta: 2026-10-28
Relacionada con: [plan](../../plans/errors/01-constantes-y-tipos-de-codigos-de-error.md), [implementación](../../../bitacora-construccion/types/01-constantes-y-tipos-de-error.md), [contrato bilingüe anterior](../config/04-errores-bilingues-y-validacion.md)
Revisión de referencia: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales previos.

## Necesidad y código observado

El catálogo [messages.ts](../../../src/common/http/messages.ts) ya define códigos,
estados y textos es/en; antes de este incremento `ErrorCode` era `keyof typeof
API_MESSAGES`. Eso ya rechazaba cadenas desconocidas en funciones tipadas. Faltaba
un valor agrupado para escribir `ErrorCodes.PROJECT_NOT_FOUND`, navegar sus usos y
obtener autocompletado de propiedades. El cambio solicitado no añade seguridad de
entrada por sí mismo: la frontera `unknown` sigue necesitando `isErrorCode`.

La [bitácora 11](../../../bitacora-construccion/settings/11-mensajes-y-errores-bilingues.md)
y el [plan anterior](../../plans/config/02-mensajes-y-errores-bilingues-es-en.md)
explican el contrato existente y su normalización de errores JSONB. El estado del
árbol de trabajo se leyó directamente; esos documentos no sustituyen al código.

## Originales y reconstrucciones

Se ejecutó el buscador oficial de la skill con `as const keyof typeof indexed
access satisfies`, tecnología TypeScript. La selección se restringió al curso
pedido y a sus secciones actuales 7 y 10; no se usó material LEGACY.
Se leyeron completos seis originales y la lección 96 como contexto mínimo de 98.
Cada R corresponde a una guía generada mediante `draft → render → verify → install`,
revisada por el agente e instalada junto al original. Las recetas y el manifest
quedan en [reconstrucciones/](reconstrucciones/).

### F1 / R1 — as const

- **Original F1:** [97. Constant Types with as const](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/97. Constant Types with as const.md>). Instructor y curso indicados arriba. Sección/camino relativo a la biblioteca del curso: `Sección 7 Advanced Types/97. Constant Types with as const.md`. Líneas físicas: 13–17; E2/E3, líneas 15 y 17.
- **Reconstrucción R1:** [97. Constant Types with as const - Reconstrucción guiada](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/97. Constant Types with as const - Reconstrucción guiada.md>). Localizador: Fases 1–2; roles y firstRole. Evidencia secundaria, contrastada con F1.
- **Interpretación aplicable:** Conservar literales concretos en el objeto ErrorCodes. [F1](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/97. Constant Types with as const.md>) + [R1](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/97. Constant Types with as const - Reconstrucción guiada.md>).

### F2 / R2 — Record

- **Original F2:** [98. Revisiting the Record Type](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/98. Revisiting the Record Type.md>). Instructor y curso indicados arriba. Sección/camino relativo a la biblioteca del curso: `Sección 7 Advanced Types/98. Revisiting the Record Type.md`. Líneas físicas: 13–17; E1/E2, líneas 13 y 15.
- **Reconstrucción R2:** [98. Revisiting the Record Type - Reconstrucción guiada](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/98. Revisiting the Record Type - Reconstrucción guiada.md>). Localizador: Fase 2; DataStore. Evidencia secundaria, contrastada con F2.
- **Interpretación aplicable:** Dar al catálogo un contrato sobre todas las claves ErrorCode. [F2](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/98. Revisiting the Record Type.md>) + [R2](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/98. Revisiting the Record Type - Reconstrucción guiada.md>).

### F3 / R3 — satisfies

- **Original F3:** [99. The satisfies Keyword](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/99. The satisfies Keyword.md>). Instructor y curso indicados arriba. Sección/camino relativo a la biblioteca del curso: `Sección 7 Advanced Types/99. The satisfies Keyword.md`. Líneas físicas: 13–29; E3/E4, líneas 19 y 21.
- **Reconstrucción R3:** [99. The satisfies Keyword - Reconstrucción guiada](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/99. The satisfies Keyword - Reconstrucción guiada.md>). Localizador: Fase 2; dataEntries. Evidencia secundaria, contrastada con F3.
- **Interpretación aplicable:** Comprobar el catálogo sin reemplazar su inferencia por un diccionario de claves arbitrarias. [F3](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/99. The satisfies Keyword.md>) + [R3](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/99. The satisfies Keyword - Reconstrucción guiada.md>).

### F4 / R4 — typeof

- **Original F4:** [119. Using typeof](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/119. Using typeof.md>). Instructor y curso indicados arriba. Sección/camino relativo a la biblioteca del curso: `Sección 10 Deriving Types From Types/119. Using typeof.md`. Líneas físicas: 13–23; E2/E3/E4, líneas 15, 19 y 21.
- **Reconstrucción R4:** [119. Using typeof - Reconstrucción guiada](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/119. Using typeof - Reconstrucción guiada.md>). Localizador: Fases 1–2; username y Username. Evidencia secundaria, contrastada con F4.
- **Interpretación aplicable:** Distinguir valor ejecutable y tipo derivado del valor. [F4](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/119. Using typeof.md>) + [R4](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/119. Using typeof - Reconstrucción guiada.md>).

### F5 / R5 — keyof

- **Original F5:** [122. Extracting Keys with keyof](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/122. Extracting Keys with keyof.md>). Instructor y curso indicados arriba. Sección/camino relativo a la biblioteca del curso: `Sección 10 Deriving Types From Types/122. Extracting Keys with keyof.md`. Líneas físicas: 13–17; E1/E2, líneas 13 y 15.
- **Reconstrucción R5:** [122. Extracting Keys with keyof - Reconstrucción guiada](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/122. Extracting Keys with keyof - Reconstrucción guiada.md>). Localizador: Fase 2; UserKeys. Evidencia secundaria, contrastada con F5.
- **Interpretación aplicable:** Extraer las claves del tipo del objeto de constantes. [F5](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/122. Extracting Keys with keyof.md>) + [R5](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/122. Extracting Keys with keyof - Reconstrucción guiada.md>).

### F6 / R6 — acceso indexado

- **Original F6:** [124. Understanding Indexed Access Types](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/124. Understanding Indexed Access Types.md>). Instructor y curso indicados arriba. Sección/camino relativo a la biblioteca del curso: `Sección 10 Deriving Types From Types/124. Understanding Indexed Access Types.md`. Líneas físicas: 13–21; E2/E3, líneas 17 y 19.
- **Reconstrucción R6:** [124. Understanding Indexed Access Types - Reconstrucción guiada](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/124. Understanding Indexed Access Types - Reconstrucción guiada.md>). Localizador: Fase 2; Perms. Evidencia secundaria, contrastada con F6.
- **Interpretación aplicable:** Extraer la unión de valores mediante (typeof ErrorCodes)[keyof typeof ErrorCodes]. [F6](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/124. Understanding Indexed Access Types.md>) + [R6](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 10 Deriving Types From Types/124. Understanding Indexed Access Types - Reconstrucción guiada.md>).

### F7 — Contexto de Record

[96. Making Sense of Index Types](</Users/benji/Documents/chrome-extencions/trancripciones/TypeScript/Boost your JavaScript projects with TypeScript Learn all about core types, generics, TypeScript + React or Node & more!/Sección 7 Advanced Types/96. Making Sense of Index Types.md>), mismo instructor y curso, sección 7. Líneas 13–23, en especial 15 y 21: firma de índice y asignaciones posteriores. Ruta relativa: `Sección 7 Advanced Types/96. Making Sense of Index Types.md`. Se consultó íntegra como contexto de R2; no se generó una guía innecesaria de esta lección.

## Evidencia, límites e interpretación

La lección 97 muestra un array de roles; no muestra un catálogo Nest. La 124
extrae `AppUser['permissions']`; no combina en ese ejemplo todos los operadores
para crear `ErrorCode`. La combinación de F1/F4/F5/F6 y su aplicación al backend
son una **adaptación del proyecto solicitada por el usuario**, no código literal
del instructor. Las guías declaran los nombres y valores que hubo que ensamblar
desde la narración traducida; no inventan adjuntos ni un proyecto ejecutable.

F3/R3 explica que `satisfies` valida un contrato conservando información concreta.
Usarlo con `Record<ErrorCode, ...>` hace que el literal del catálogo deba incluir
todos los códigos y rechace claves extra y estructuras incompatibles. Esta
aplicación se contrastó además con la documentación oficial F8.

## F8 — Contraste oficial de TypeScript

Consulta: 2026-10-28. La versión instalada del proyecto se registra al verificar.

- [Typeof Type Operator](https://www.typescriptlang.org/docs/handbook/2/typeof-types.html): `typeof` en posición de tipo deriva el tipo de un valor.
- [Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html): apartado que usa `Person[keyof Person]`; confirma la unión de tipos de todas las propiedades.
- [TypeScript 3.4 — const assertions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html#const-assertions): preserva literales, marca propiedades readonly y presenta objetos con valores constantes como alternativa a enum. No equivale a congelar objetos en ejecución.
- [TypeScript 4.9 — The satisfies Operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator): comprueba compatibilidad y claves de un Record sin perder inferencia concreta.

## Adaptación propuesta

```ts
export const ErrorCodes = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  INVALID_UUID: 'INVALID_UUID',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

El fragmento es reducido y propio del proyecto. La implementación conservará todos
los códigos actuales y dejará `API_MESSAGES` como catálogo de estados y traducciones,
con claves `[ErrorCodes.X]` y `satisfies Record<ErrorCode, ...>`. Los valores de red
y JSONB seguirán siendo las mismas cadenas. No se requiere migración SQL.

`isErrorCode(unknown)` comprobará los valores reales de las constantes antes de
tratarlos como ErrorCode. Los códigos de proveedores (`ENOENT`, códigos Multer),
los estados de jobs y los identificadores de logs internos fuera del catálogo
pertenecen a otros contratos y no se incorporan por semejanza de nombre.

El tipo derivado sigue siendo una unión de literales: TypeScript permite pasar
una cadena literal válida. El alcance es sustituir los usos actuales del código
de aplicación por propiedades; prohibir toda cadena futura exigiría otra regla
de lint o un tipo nominal, fuera del diseño solicitado.

## Verificación de la evidencia

El helper verificó seis guías y siete originales/contextos por frases, líneas y
hashes; después se leyó todo el Markdown generado y se instalaron seis guías sin
sobrescribir ninguna. No se compiló el curso por validar sus documentos. Las
comprobaciones de la adaptación se registran en la bitácora relacionada.
