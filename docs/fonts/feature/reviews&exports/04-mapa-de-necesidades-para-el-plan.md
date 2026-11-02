# 04 — Mapa de necesidades y fuentes para el plan de reviews y exports

Fecha de creación: 2026-11-01  
Última actualización: 2026-11-01 (plan escrito: [01-plan-reviews-y-exports](../../../plans/feature/reviews&exports/01-plan-reviews-y-exports.md); cada `N` se decide en su `D` homónima)  
Estado: Investigación; las decisiones están en el plan; nada implementado.  
Tipo de fuente: elaboración propia a partir de las fichas 01–03.  
Origen: requisitos de `docs-diagrams`, código actual, cursos reconstruidos y documentación oficial.  
Fecha de consulta: 2026-11-01  
Revisión del proyecto: `d5e8f54`.  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [plan 01](../../../plans/feature/reviews&exports/01-plan-reviews-y-exports.md), carpeta de bitácora `bitacora-construccion/feature/reviews&exports/` (vacía).

## Propósito

Índice para escribir el plan sin repetir la búsqueda. Cada fila sigue el formato **Necesidad → requisito → fuentes → decisión pendiente**. Los `F` remiten a las fichas 01–02; los `C`/`RC`, a la ficha 03.

## Necesidad → requisito → fuentes → decisión pendiente

| # | Necesidad | Requisito | Fuentes | Decisión que debe tomar el plan |
| --- | --- | --- | --- | --- |
| N1 | Solo se exporta una evaluación terminada del proyecto propio y con productos válidos | RF05 «bloquear un feed vacío»; actividad de revisión | F1, F3, F7, F16 | Comprobar `status = 'succeeded'` y `valid_count > 0` en el servidor. Qué código y estado devolver: ¿`409 EXPORT_NO_VALID_PRODUCTS` y `409 EVALUATION_RESULTS_UNAVAILABLE` (ya existe)? `404` para evaluaciones ajenas, como en las features anteriores. |
| N2 | El operador confirma expresamente las exclusiones | RF05; F4: la aprobación identifica evaluación, suma y exclusiones aceptadas | F1, F4, F7, F9, RC4 | Qué envía el cliente: `evaluationId` + `resultChecksum` que vio + conteos `invalid`/`excluded` aceptados, o una marca booleana. El servidor recalcula desde `evaluation_rows` y rechaza si no coincide (RC4: no confiar en lo que manda el cliente). ¿Se exige confirmación aunque no haya inválidas ni excluidas? |
| N3 | Aprobar una vista previa no aprueba una revisión posterior; la evaluación debe «seguir vigente» | Inv. 4; actividad de revisión | F1, F2, F7, F14; hallazgo 3 de la ficha 01 | Definir «vigente»: ¿basta con que la suma enviada coincida con `result_checksum` y la evaluación exista, o también debe ser la más reciente `succeeded` del proyecto? ¿Se bloquea la evaluación (`FOR SHARE`) durante la exportación frente a `deleteSnapshot`? |
| N4 | Serializar `productos.tsv` | F5; inv. 3 (solo filas `valid`) | F8, F17, F18, F20, F21, RC2, RC3 | Función pura: cabecera `id` + `PRODUCT_ATTRIBUTES` en su orden; ¿incluir siempre las ocho columnas o solo las mapeadas? Celdas vacías permitidas (F17). Terminador de línea (`\n` o `\r\n`; IANA no lo fija), sin tabulador final (F18), UTF-8 y ¿BOM? (sin respaldo en F17). Filas por `source_row`. |
| N5 | Escapar tabuladores, saltos de línea y comillas | F18, F21 prohíben `\t`/`\n`; F19 los admite entre comillas si la fuente lo permite | F18, F19, F21, F25, F26; hallazgo 1 de la ficha 01 | Elegir entre: (a) rechazar al exportar una fila válida con `\t`/`\n`; (b) entrecomillar los valores afectados, doblando comillas (F19), con el riesgo de que la fuente del cliente no tenga activados los campos entrecomillados; (c) que el motor marque esos valores como problema (cambia `ENGINE_VERSION`/`PROFILE_VERSION` y obliga a reevaluar). Qué hacer con un valor que empieza por comilla. La mitigación OWASP de `errores.csv` no sirve (F26). |
| N6 | Guardar el TSV como archivo completo y verificado | Inv. 5; ADR05; puerto `ArtifactStore` con claves internas | F2, F3, F10, F11, F12, RC1, RC3, C7, C10 | Guardar el archivo o regenerarlo en cada descarga (RC2; F15 mide 13 ms). Si se guarda: carpeta o extensión propia (`exports/<uuid>.tsv`), operación nueva para escribir un archivo generado (`wx` + `sync` + enlace exclusivo), ampliar la limpieza para que consulte las referencias de exportaciones, o extraer `ArtifactStore` a un módulo común exportado (RC3; aplazado en D8 del plan anterior). Qué se verifica tras escribir: tamaño y SHA-256 releídos. |
| N7 | Persistir la exportación y lo aceptado | F6 «no crear de antemano tablas de feeds»; inv. 1 | F2, F6, F7, F23, F24, RC4, RC5 | Tabla mínima (por ejemplo `exports`): `project_id`, `evaluation_id` con FK compuesta a `evaluations (project_id, id)`, `artifact_key`, `tsv_checksum`, `byte_size`, conteos aceptados, `result_checksum` aprobado, `created_at`. ¿Una sola exportación por evaluación (`UNIQUE`) o varias? ¿Tabla hija de exclusiones aceptadas o basta con conteos + suma? Insertar en una escritura anidada o transacción corta (F24). No crear `feed`, `feed_version` ni `published_version`. |
| N8 | Ejecutar de forma síncrona o con trabajador | RNF03 (concurrencia limitada para tareas pesadas) | F15, RC2, F22 | Con 5.000 filas como máximo y 13 ms medidos para un archivo similar, ¿basta con hacerlo dentro del POST? Si es síncrono, no hace falta tabla de trabajos ni worker. Medir la generación del TSV de 5.000 filas en la etapa que lo implemente. |
| N9 | Contrato HTTP | F3: `POST /projects/{id}/exports` | F3, F13, F21, F22, C8 | ¿El POST devuelve `201` con metadatos y una URL de descarga (`GET …/exports/{exportId}/productos.tsv`), o el archivo directamente? Cabeceras: `text/tab-separated-values; charset=utf-8` y `Content-Disposition: attachment; filename="productos-<id>.tsv"` o `.txt` (F17 frente a F18). ¿`GET` de lista de exportaciones del proyecto? |
| N10 | Errores públicos y mensajes | Patrón vigente | F16 | Códigos nuevos (`EXPORT_NOT_FOUND`, `EXPORT_NO_VALID_PRODUCTS`, `EXPORT_APPROVAL_MISMATCH`, `EXPORT_VALUE_NOT_EXPORTABLE`…) con texto es/en; ¿alguno necesita `issues` (`CODES_WITH_ISSUES`), por ejemplo para listar filas con tabuladores? |
| N11 | Borrado de proyectos, snapshots y evaluaciones con exportaciones | D14 del plan anterior | F14, F23, F11 | ¿`exports → evaluations` en cascada (la exportación es parte de la evaluación) o `RESTRICT` (objeto independiente que hay que borrar a propósito)? `deleteSnapshot` y `deleteProject` deben devolver también las claves de los TSV para retirarlos tras el commit; la limpieza al arrancar debe conocer esas referencias. |
| N12 | Resumen de exclusiones para revisar | RF05: las exclusiones por reglas aparecen en el resumen | F1, F7; hallazgo 4 de la ficha 01 | ¿Basta con lo existente (`GET …/evaluations/{id}` con conteos y `…/rows?outcome=excluded|invalid`, `errores.csv`) o hace falta un recurso de revisión? Las filas excluidas no guardan valores. |
| N13 | Probar la feature | Patrón vigente | RC6, C8, C9, F38 de la feature anterior | Pruebas unitarias del serializador y del escape; integración con PGlite (FK compuesta, unicidad, cascadas); E2E con Supertest y dos propietarios; raíz de artefactos temporal y limpieza (RC6). PGlite no demuestra bloqueos entre procesos. |
| N14 | Comprobar el TSV en Merchant Center | Aceptación del incremento 3: procesar TSV en una cuenta piloto | F6, F17, F19 | Comprobación manual del usuario, fuera de las pruebas automatizadas; registrar si la fuente tiene activados los campos entrecomillados. |

## Vacíos sin fuente suficiente

- Comportamiento de Google ante un valor sin comillas con `\t` o que empieza por comilla, con los campos entrecomillados activos: no documentado en las páginas leídas (ficha 02).
- BOM en el TSV: ninguna fuente de Google lo pide ni lo prohíbe.
- Extensión `.tsv` frente a `.txt`: F17 y F18 difieren; para una descarga privada no es decisivo.
- Criterio de «vigencia» de una evaluación: los diagramas lo nombran sin definirlo.
- Rendimiento de la generación del TSV: no medido; solo hay la referencia de `errores.csv`.

## Siguiente paso

Escribir `docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md` cuando el usuario lo pida: una decisión `D` por cada `N`, citando sus `F`, `C` o `RC`, con etapas pequeñas que empiecen por lo puro (serializador TSV y comprobación de la aprobación).
