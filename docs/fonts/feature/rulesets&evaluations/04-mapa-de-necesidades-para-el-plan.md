# 04 — Mapa de necesidades y fuentes para el plan de rulesets y evaluations

Fecha de creación: 2026-10-31  
Última actualización: 2026-10-31 (plan escrito: [01-plan-rulesets-y-evaluations](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md); cada `N` se decide en su `D` homónima; N3 se completó con la [ficha 05](05-experimento-discriminador-y-validationpipe.md) y N10 con la [ficha 06](06-csv-de-errores-owasp-y-rfc4180.md)); 2026-11-01 (N1 y N8 completadas con la [ficha 07](07-unicidad-prisma-pglite-e-indice-parcial.md); N10 y el vacío de rendimiento, con la [ficha 08](08-informe-bom-streamablefile-y-medicion.md))  
Tipo de fuente: elaboración propia a partir de las fichas 01–03.  
Origen: requisitos de `docs-diagrams`, código actual, cursos reconstruidos y documentación oficial.  
Fecha de consulta: 2026-10-31  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), carpeta del plan `docs/plans/feature/rulesets&evaluations/` (vacía), carpeta de bitácora `bitacora-construccion/feature/rulesets&evaluations/` (vacía).

## Propósito

Índice para escribir el plan sin repetir la búsqueda. Cada fila une una necesidad con su evidencia y deja abierta la decisión. Nada de esta tabla está implementado ni decidido.

## Necesidad → fuentes → decisión pendiente

| # | Necesidad | Requisito | Fuentes | Decisión que debe tomar el plan |
| --- | --- | --- | --- | --- |
| N1 | Guardar mapeo y reglas como versión inmutable con revisión creciente | RF03; F2; F3 | F9 (`FOR UPDATE` en `accept`), F22, F23, F24 | Tabla `ruleset_versions` y sus columnas; cálculo de `revision` con el proyecto bloqueado; `UNIQUE (project_id, revision)`; P2002 → `409`. ¿Se exige que el proyecto esté configurado (como `PROJECT_CONFIGURATION_REQUIRED`)? |
| N2 | Recibir el mapeo columna CSV → atributo del canal | RF03; F5 | RC1 (`@IsIn`), RC2 (arreglo anidado), F18, F19 | Forma del mapeo (arreglo de pares o lista por atributo); validar contra `headers` de un snapshot o solo contra el perfil; atributos obligatorios del perfil sin mapear. |
| N3 | Recibir una lista ordenada de reglas de tres tipos | RF03; F5 | RC2, RC6, F16, F17, F18, F20, F21 | DTO base con `type` validado + subclases por discriminador (`keepDiscriminatorProperty`), o un DTO único con campos condicionales. Máximo de reglas (`@ArrayMaxSize`). Guardar como arreglo JSON, nunca como objeto con claves de orden. |
| N4 | Definir las tres reglas | F5; F2 inv. 2 | RC7, RC8, RC9, F26, F19 | Parámetros de «limpiar texto» (campos, NFC, espacios), «construir título» (plantilla y límite de 150), «excluir por condición» (operadores admitidos). Ninguna regla puede modificar la columna identificadora. |
| N5 | Motor de evaluación determinista y probado | RNF02; F4 | RC7, RC8, RC9, C10, C11, C14 | Función pura `evaluate(rows, versión, perfil)` sin Prisma/HTTP/disco; `engine_version` y `profile_version` como constantes versionadas; manejadores por tipo o `switch` exhaustivo. |
| N6 | Validar cada fila contra el perfil `google_merchant` | RF04; F19 | F19, F26 | Qué atributos se validan en esta fase y con qué códigos de problema; formato de precio aceptado sin inferir separadores (RNF04) y moneda del proyecto; mensajes con corrección sugerida. |
| N7 | Contar y clasificar filas | F2 inv. 3; RF04 | — (regla de dominio) | Una fila excluida por regla frente a inválida por validación; garantizar `válidos + inválidos + excluidos = total` en el motor y en la persistencia. |
| N8 | Ejecutar la evaluación como trabajo asíncrono | F3; F4 | F9, F10, F11 | Reutilizar o generalizar el trabajador y `ArtifactStore` de catalog-import, o crear uno propio; snapshot exigido `ready`; qué hacer si el proyecto o el snapshot se borran con una evaluación en curso (hoy `deleteProject` comprueba trabajos activos de importación). |
| N9 | Guardar resultados e informe | F2; F4 | F11, F20, F25 | Resumen y conteos en PostgreSQL; filas normalizadas y problemas en artefactos (CSV/JSON); vincular evaluación a snapshot y revisión exactas del mismo proyecto. |
| N10 | Consultar resultado y problemas paginados | F3 | F12 | `GET` de evaluación con conteos, muestra y problemas con `limit/offset`; ¿se leen del artefacto o de una tabla? |
| N11 | Errores públicos y mensajes | F3 | F13 | Códigos nuevos (`RULESET_*`, `EVALUATION_*`) es/en; `404` para recursos ajenos; `409` en revisiones o estados incompatibles. |
| N12 | Exponer también por GraphQL | Patrón vigente | F14 | Si este incremento incluye resolvers o se deja para después. |
| N13 | Probar DTOs, motor y flujo | Patrón vigente | RC3, RC4, RC5, C13, F15; guías 51 y 80 de [config/02](../../config/02-reconstrucciones-verificadas-testing.md) | Pruebas unitarias de DTO con `plainToInstance` y búsqueda en `children`; pruebas del motor sin Nest; integración PGlite y E2E con dos propietarios. |
| N14 | Borrado y retención | Continuidad de [bitácora 05](../../../../bitacora-construccion/feature/projects&catalog-import/05-eliminar-proyectos-e-importaciones.md) | F8, F9, F11 | Cascada o `RESTRICT` desde snapshot/proyecto hacia versiones y evaluaciones; retirada de artefactos de evaluación. |

## Vacíos sin fuente suficiente

- Política de parseo de precios con separadores regionales: RNF04 prohíbe inferir; ninguna fuente consultada fija qué formatos aceptar. Decisión propia del plan.
- Rendimiento con 5.000 filas: no hay medición; el plan debe prever cómo medir duración y memoria del motor.
- Secciones finales de la especificación de Google (envío, destinos): no se leyeron; no se necesitan si el perfil inicial solo valida los atributos básicos.

## Siguiente paso

Escribir `docs/plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md` tomando N1–N14 como índice, decidir cada columna «Decisión» citando sus F/RC/C, y abrir después la entrada `01` de la bitácora cuando empiece la implementación.
