# 02 — Hacer common/http más legible conservando su comportamiento

Fecha de creación: 2026-10-28
Estado: Ejecutado y verificado
Ámbito: Lectura y mantenimiento de src/common/http
Relacionada con: [investigación 02](../../fonts/types/02-legibilidad-common-http.md), [plan anterior](01-constantes-y-tipos-de-codigos-de-error.md), [ejecución 02](../../../bitacora-construccion/types/02-legibilidad-common-http.md)
Revisión de referencia: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con el sistema actual en el índice y trabajo previo conservado.

## Objetivo y criterio del usuario

Conservar una solución que ya funciona y presentar sus decisiones para que una
persona pueda leerlas y mantenerlas. No se parte de un defecto funcional ni de la
necesidad de instalar una librería. No se busca minimizar el número de caracteres.

La función principal de cada módulo debe mostrar pasos reconocibles, con nombres
que describan su intención y condiciones que no requieran descifrar ternarios
anidados. Los detalles relacionados permanecen cerca, como helpers privados.

## Punto de partida y contratos

Los siete archivos de common/http tienen 613 líneas en conjunto; el catálogo y
las constantes ocupan 349. Los puntos de flujo están en el filtro, JSONB histórico,
middleware y validación. Los módulos de auth, users, projects e importación ya usan
las exportaciones existentes. El catálogo tipado y sus 54 códigos se conservan.

Deben permanecer los estados, clases de excepciones Nest, mensajes es/en, códigos,
requestId, incidencias opcionales, contexto histórico admitido y middleware previo
al normalizador. También el orden y deduplicación de incidencias, las entradas
desconocidas admitidas y la normalización de datos guardados sin reescribirlos.

## Fuentes y decisión

La [ficha 02](../../fonts/types/02-legibilidad-common-http.md) relaciona F1–F7 de
las secciones de Clean Code, SOLID y Clean Architecture pedidas por el usuario,
además de F8/R1 de Maximilian sobre guards con nombre y F9 oficial de TypeScript.

Se eligen funciones internas en los archivos actuales: separar operaciones
significativas sin crear nuevas capas ni trasladar la dificultad entre archivos.
Se conservan las interfaces públicas y los imports del resto de las features.

## Incrementos previstos

1. Guardar una referencia temporal del código inicial y comprobar sus exports.
   Esa versión será el oráculo para casos diferenciales, no una versión inferida
   desde la bitácora o desde el código que se pretende escribir.
2. Refactorizar el filtro: lectura explícita de estado/cuerpo, resolución de código,
   guard de incidencia, normalización y respuesta. Mantener logging y headersSent.
3. Refactorizar errores guardados: separar extracción de contexto permitido y
   nombrar las restricciones, manteniendo fallback y límites actuales.
4. Mostrar transporte con guard y switch sobre los tipos del parser de Express.
   Conservar su registro en configureHttp y su función de traducción.
5. En validación, separar resolución de código y ordenación del recorrido. Expresar
   las fábricas de excepciones y el cuerpo opcional de apiError con bloques claros.
6. Mantener mensajes y ErrorCodes como datos explícitos; no reformatearlos ni
   introducir abstracciones de catálogo sin beneficio para esta necesidad.
7. Comparar comportamiento inicial/final, ejecutar las pruebas existentes y
   completar la bitácora con evidencias y límites de legibilidad.

## Verificación prevista

- Build, lint y formato del proyecto; ninguna modificación de sus configuraciones.
- Suites existentes de features y regresiones Node con HTTP y persistencia locales.
- Harness diferencial temporal para entradas `unknown`, errores estándar y de
  aplicación, incidencias inválidas/válidas, contexto histórico, reglas anidadas,
  parser, logs y respuesta ya enviada. Comparar también los fallos que ya existían,
  sin convertir esta refactorización en cambios de políticas o endurecimiento.
- Confirmar igualdad del catálogo, nombres/exportaciones anteriores y ausencia
  de cambios en módulos consumidores o dependencias.
- Revisión de lectura: catch debe expresar el proceso, no la inspección detallada
  de cada campo; los helpers tendrán nombres que permitan predecir su resultado.

## Límites

Se conservarán las comprobaciones de runtime necesarias para unknown; un tipo no
las reemplaza. No se añadirá una clase por condición ni se aplicará un máximo
arbitrario de líneas. Podrán aumentar las líneas al hacer explícitas decisiones.
Los comentarios explicarán restricciones o procedencia de datos, no repetirán la
sintaxis. La valoración final de si esta presentación le resulta más cómoda al
usuario no se sustituye por pasar tests ni por citar un curso.

## Resultado de ejecución

Se aplicó el plan en los cinco módulos de flujo, conservando los siete archivos
de la base y todas sus exportaciones. El catálogo y ErrorCodes quedaron idénticos
al punto de partida. La [bitácora 02](../../../bitacora-construccion/types/02-legibilidad-common-http.md)
registra los cambios y su lectura propuesta: build, lint, formato, 180 pruebas
de features, 11 regresiones Node y 951 comparaciones diferenciales correctas.
