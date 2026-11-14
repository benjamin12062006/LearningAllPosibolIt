# 06 — C7.5: cliente Python, contrato para el agente y Nuxt, y cobertura medida

Fecha de creación: 2026-11-14  
Estado: Implementado y verificado (2026-11-14). Sin commit. Cierra C7.  
Relacionada con: [plan 02 de C7](../../../docs/plans/feature/graphql&rulesets-evaluations-exports/02-plan-c7-implementar-graphql.md) (C7.5, G9), [ficha 05, matriz](../../../docs/fonts/feature/graphql&rulesets-evaluations-exports/05-inventario-y-alcance-de-c7.md), [23, «Cierre antes de C»](../../../../docs-diagrams/23-graphql-nest-para-fastapi-y-nuxt.md), [bitácora 05, C7.4](05-hojas-borradores-vistas-y-catalogo.md).  
Revisión de partida: `feature/cierre-backend` `fb32457` más C7.1–C7.4 sin commit.

## Necesidad

El documento 23 pide, antes del Bloque C: FastAPI llamando a Nest por GraphQL con operaciones predefinidas, rechazo de una credencial incorrecta, aislamiento con dos organizaciones, ejemplos comprobables por pantalla para Nuxt y la cobertura medida contra el esquema.

## Evidencia → decisión → aplicación

| Evidencia | Decisión | Aplicación |
| --- | --- | --- |
| 23: «operaciones predefinidas y variables tipadas» | Las operaciones del agente son archivos `.graphql` con nombre; el cliente las carga y las llama por su nombre | [`contracts/graphql/agent`](../../../contracts/graphql/agent), [`nest_graphql.py`](../../../contracts/python/nest_graphql.py) |
| Plan: el cliente del agente de verdad lo escribe la sesión de FastAPI | Aquí, un cliente mínimo con solo la biblioteca estándar (`urllib`, `json`): prueba el contrato sin añadir dependencias | `NestGraphQL`, `NestGraphQLError` |
| Apollo responde 400 a lo que rechaza antes de ejecutar (coste, documento) | El cliente lee el cuerpo GraphQL también en un 400 y lanza el error con su `code` y `requestId` | `_post`, `_error_from` |
| 23: «ejemplos por pantalla … comprobables contra Nest» | Una operación por pantalla de Nuxt (proyecto, reglas, evaluación, visor, feed, hoja, borrador, libros) | [`contracts/graphql/nuxt`](../../../contracts/graphql/nuxt) |
| Ficha 05: 24 operaciones que el agente no puede usar | La prueba del contrato recorre los campos de cada operación del agente con el esquema y falla si usa una | [`contracts.spec.ts`](../../../test/features/graphql/contracts.spec.ts) |
| La matriz se generó a mano desde los controladores | La cobertura la mide una prueba que lee la tabla de la ficha 05, la compara con las rutas montadas y busca cada equivalente en el esquema esperado | [`coverage.spec.ts`](../../../test/features/graphql/coverage.spec.ts) |
| G9: en C7 el cliente usa la sesión Bearer de una persona | La comprobación usa dos sesiones (Alice y Bob, dos organizaciones), una inválida y ninguna; la identidad delegada es de E6.3a | [`check_contract.py`](../../../contracts/python/check_contract.py) |

No se consultaron cursos: la biblioteca estándar de Python y la API de graphql-js (`validate`, `TypeInfo`) cubren lo necesario.

## Lo que comprueba el cliente Python contra Nest arrancado

La prueba [`python-contract.e2e-spec.ts`](../../../test/features/graphql/python-contract.e2e-spec.ts) arranca la API GraphQL por HTTP real, prepara dos organizaciones, un catálogo, un libro y una hoja, y ejecuta `python3 check_contract.py`. Si la máquina no tiene Python 3, la prueba se salta (no falla).

| Comprobación | Resultado |
| --- | --- |
| `me` con la sesión de Alice (sin correo: no sale hacia la IA) | OK |
| Resumen del proyecto en una llamada, rol `owner` | OK |
| `createRuleset` con `@oneOf` | OK |
| `rulesPreview` sin guardar | OK |
| `requestEvaluation` en cola | OK |
| Proponer un cambio en una hoja: crear, guardar (diff con 1 fila) y enviar (`pending_review`) | OK |
| `suggest_view` como vista personal | OK |
| Errores de validación como en REST (`rules.0.template`) | OK |
| Aislamiento: Bob no ve el proyecto ni la hoja de Alice (404) y sí el suyo | OK |
| Credencial inválida (`AUTH_SESSION_INVALID`) y sin credencial (`AUTH_SESSION_REQUIRED`) | OK |
| Límite de coste: 400 `GRAPHQL_QUERY_TOO_COSTLY` | OK |

## Cobertura medida

`coverage.spec.ts`: **109 rutas montadas = 109 filas de la matriz**, sin repetidas; **85 con equivalente (78,0 %)** y los 85 existen en el esquema; 10 solo HTTP y 14 en REST. El esquema esperado tiene 59 operaciones raíz.

## Comprobaciones realmente ejecutadas (2026-11-14)

- **Pruebas:** 22 del contrato (10 archivos del agente y 8 pantallas válidos con el esquema, la profundidad y el coste; nombres sin repetir; ninguna operación prohibida; las 24 prohibidas existen), 1 E2E del cliente Python y 3 de cobertura.
- **Defectos a propósito:** **8 de 8 detectados.**

  | Id | Defecto | Detectado |
  | --- | --- | --- |
  | C75-1 | El cliente ignora los errores | Sí |
  | C75-2 | El cliente no manda la sesión | Sí |
  | C75-3 | El error pierde el `requestId` | Sí |
  | C75-4 | Un 400 de Apollo rompe el cliente | Sí |
  | C75-5 | El agente usa una operación prohibida | Sí |
  | C75-6 | Una pantalla de Nuxt pasa del coste | Sí |
  | C75-7 | Un equivalente prometido falta en el esquema | Sí |
  | C75-8 | Una ruta montada no está en la matriz | Sí |

## Verificación completa de C7 (2026-11-14)

| Comprobación | Resultado |
| --- | --- |
| `tsc` (código y pruebas), `pnpm lint`, Prettier | Limpios |
| Batería completa | **119 suites pasan (1 saltada) y 1.841 pruebas (5 saltadas)**. Antes de C7: 110 suites y 1.769 pruebas |
| Pruebas GraphQL con el código final (tras unificar `IdArg` en feeds) | 11 suites y 92 pruebas |
| Defectos a propósito de C7 | C7.1 15/15, C7.2 14/14, C7.3 10/10, C7.4 13/13, C7.5 8/8 |
| Arranque real (módulo raíz, procesos de fondo y un servicio de IA de mentira) | Todo OK. Comprobaciones nuevas de C7: resumen del proyecto, hoja con filas, historial y vistas, GraphQL sin sesión (`AUTH_SESSION_REQUIRED`) y consulta demasiado cara (400); apagado limpio y sin errores registrados |
| `pnpm db:verify` | 3 de 3: las 35 migraciones se despliegan sobre PGlite y no se repiten |
| Cloud SQL | El usuario aplicó las migraciones 32–35; `pnpm db:status` (solo lectura) dice «Database schema is up to date!» con las 35 |
| Migraciones nuevas en C7 | Ninguna: C7 no toca el esquema de la base |

**No ejecutado:** `pnpm test:features:postgres` (la batería contra un PostgreSQL en contenedor). C7 no añade SQL; las migraciones de H1–H5 ya están aplicadas en Cloud SQL.

## Consecuencias

- **C7 queda cerrado en Nest.** El Bloque C (E6.1b.2 en adelante) tiene un contrato probado: operaciones con nombre, errores con código y `requestId`, límites y aislamiento.
- **Lo que no cubre C7:** la identidad delegada del agente (token por ejecución y catálogo de operaciones permitidas) es de E6.3a; hoy la prohibición de las 24 operaciones está en el contrato y en sus pruebas, no en el servidor.
- Cualquier ruta REST nueva tiene que entrar en la matriz de la ficha 05 (la prueba de cobertura falla si no).
