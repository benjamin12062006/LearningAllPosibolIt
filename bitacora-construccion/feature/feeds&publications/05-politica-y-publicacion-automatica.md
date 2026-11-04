# 05 — Política aprobada y publicación automática (E5)

Fecha de creación: 2026-11-03  
Última actualización: 2026-11-03 (etapa cerrada)  
Estado: Implementado y verificado en local. Migración `20261103000300_add_feed_policy` **aplicada en Neon** el 2026-11-03. El primer intento lo bloqueó el sistema de permisos, que lo trata como despliegue a producción; se aplicó cuando el usuario lo pidió expresamente. Después, `pnpm db:status` → «Database schema is up to date!», 16 migraciones.  
Ámbito: etapa E5 del [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md): columnas y `PUT …/feeds/:feedId/policy`, `checkRefreshPolicy`, paso `publish` que exporta y publica con la generación leída al disparar, con la comprobación del token en la misma transacción (D11, D3, D6).  
Relacionada con: [plan 01](../../../docs/plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), [bitácora 04](04-trabajo-de-actualizacion-con-lease.md), [bitácora 01](01-feed-y-publicacion-manual.md), [fuentes técnicas](../../../docs/fonts/feature/feeds&publications/02-fuentes-tecnicas.md) (F18), [cursos y reconstrucciones](../../../docs/fonts/feature/feeds&publications/03-cursos-y-reconstrucciones.md) (RC1).  
Revisión de partida: `f6b4bf9` con los cambios sin commit de E1–E4. Línea base: 50 suites y 899 pruebas en verde.

## Necesidad y punto de partida

El usuario pidió empezar E5. E4 dejaba la actualización terminando tras la evaluación (resultado provisional `evaluated`) y usando la última revisión de reglas. No hubo investigación externa nueva: el control de concurrencia es el de E1 (RC1, F18) y el token, el de E4.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Política explícita del operador (D11) | docs-diagrams/08 («no será una cifra oculta») | `PUT …/policy` con `rulesetRevision`, `maxInvalid`, `maxExcluded` y `maxDropPercent`, todos obligatorios. El servidor guarda `ENGINE_VERSION`, `PROFILE_VERSION` y la fecha. La revisión debe existir en el proyecto (`404 RULESET_NOT_FOUND`). |
| Sin política no hay actualización | D11 | `POST …/refreshes` → `409 FEED_POLICY_NOT_APPROVED`. |
| Comprobación pura, en el orden del plan | Patrón de `findExportBlocker` | `checkRefreshPolicy`: versiones → sin válidos → inválidos → excluidos → caída. Límites inclusivos; la caída se compara en enteros (`válidos × 100 < publicados × (100 − caída)`). Sin versión publicada no hay caída. |
| Incumplir no es fallar | D11 | La actualización termina `succeeded` con `needs_review` y el motivo en `error`; la publicación anterior no cambia. |
| La política sustituye a la aprobación manual | D11, plan reviews&exports (D2) | `ExportsService.createForOwner` con la suma y los conteos de la propia evaluación; si ya existía la exportación, se reutiliza. |
| No pisar una publicación del operador | D11, RC1, F18 | `expected_generation` se lee en la misma sentencia que crea la actualización. Al publicar, si la generación ya no es esa → `conflict` (`REFRESH_PUBLICATION_CONFLICT`). |
| El token dentro de la transacción que publica (D3) | F5 de la ficha 01 | `FeedsRepository.publish(record, confirm)`: `confirm` cierra la actualización (`finishPublished`) en la misma transacción que mueve el puntero. Si el reclamo ya no es el vigente, lanza `LostClaimError`, la transacción se deshace y el enlace del archivo se borra. |
| Mismo TSV → sin versión nueva | D11 | Resultado `unchanged`. |

### Ajustes al escribir el código (marcados «en E5» en el plan)

- **Desaparece lo provisional de E4.** El resultado `evaluated` sale del tipo y del `CHECK` de la base (la migración sustituye la restricción `feed_refreshes_outcome_check`). La revisión de reglas sale de la política, y `REFRESH_RULESET_MISSING` se sustituye por `REFRESH_POLICY_MISSING`.
- **`StepResult` gana `finished`:** el paso `publish` ya cerró la actualización dentro de su transacción y el worker no debe guardar nada más.
- **Errores de exportación definitivos.** `EXPORT_EVALUATION_SUPERSEDED`, `EXPORT_EVALUATION_OUTDATED` y `EXPORT_NO_VALID_PRODUCTS` se añadieron a la lista de `refresh-retry`: repetir no los arregla.
- **Sin generación del disparo, no se publica.** La columna es nula en las filas creadas antes de esta migración (en Neon no hay ninguna): el resultado es `conflict`, en lugar de suponer una generación.
- **`FeedsModule` y `ExportsModule` exportan su servicio** para la actualización. `FeedRefreshesModule` sigue por encima: ninguno depende de él.

## Implementación y funcionamiento

- [migration.sql](../../../prisma/migrations/20261103000300_add_feed_policy/migration.sql): siete columnas de política con rangos y un `CHECK` de «completa o nada»; `expected_generation` en `feed_refreshes`; el nuevo `CHECK` de `outcome`.
- [src/feeds/](../../../src/feeds/):
  - `FeedPolicy` y `PolicyInput`, y `policy` en la vista del feed;
  - `ApproveFeedPolicyDto` y `PUT …/policy`;
  - `FeedsService.approvePolicy` y `FeedsService.publishForRefresh`;
  - `FeedsRepository.setPolicy`, `rulesetRevisionExists` y `publish(…, confirm)`.
- [src/feed-refreshes/](../../../src/feed-refreshes/):
  - `refresh-policy.ts`, función pura;
  - en los pasos: `publish`, `exportApproved` y `publishExport`;
  - en el repositorio: `finishPublished`, `succeed(…, reason)`, `findEvaluationResult` y `findPublishedRowCount`, y la lectura de política y generación en `claim`.
- [ExportsService.createForOwner](../../../src/exports/exports.service.ts): `create` lo llama tras resolver al propietario.
- Códigos nuevos con textos es/en:
  - `FEED_POLICY_NOT_APPROVED` y `REFRESH_POLICY_MISSING`;
  - `REFRESH_POLICY_VERSIONS_CHANGED`, `REFRESH_POLICY_NO_VALID_PRODUCTS`, `REFRESH_POLICY_TOO_MANY_INVALID`, `REFRESH_POLICY_TOO_MANY_EXCLUDED` y `REFRESH_POLICY_PRODUCT_DROP`;
  - `REFRESH_PUBLICATION_CONFLICT`.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Pruebas | 9 unitarias de la política. En integración, 10 nuevas: `published`, `needs_review` por inválidos, por versiones y por caída, `unchanged`, `conflict`, token antiguo sin efectos dentro de la transacción, disparo sin política, generación guardada y política incompleta en la base. 5 E2E nuevas: `PUT …/policy` y disparo sin política; el recorrido HTTP termina descargando la URL pública. Las de E4 se adaptaron a `published` y a la política. |
| Suite completa | 51 suites y 932 pruebas en verde (antes 50 y 899). Incluye las de organizaciones, de otra sesión. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check src test/features` | Sin errores. |
| Esquema frente a migraciones; `pnpm db:verify` | «This is an empty migration»; 3/3. |
| Arranque real con el worker encendido | `PUT …/policy` y las rutas de actualizaciones responden `401` sin sesión; sin errores registrados. |
| Defectos a propósito | 9 de 10 detectados, con restauración comprobada byte a byte. R5 (quitar la comprobación previa de la generación en `publishForRefresh`) sobrevive a propósito: el `UPDATE` condicional del repositorio (RC1) detecta el mismo conflicto, así que son dos capas. |

**Lista de defectos:**

- R1, política sin comprobar;
- R2, versiones;
- R3, caída no inclusiva;
- R4, `confirm` fuera de la transacción;
- R5, comprobación previa de generación (sobrevive, ver arriba);
- R6, mismo TSV;
- R7, disparo sin política;
- R8, revisión inexistente;
- R9, generación no guardada;
- R10, `CHECK` de política.

**Dos tropiezos en la verificación:**

1. Una ejecución dio «33 passed» con una compilación antigua, porque el error de tipos de una prueba nueva quedó oculto tras `>/dev/null`. El primer intento de defectos lo reveló («no compila» incluso sin defecto). Se corrigió la prueba y desde entonces se comprueba el resultado de la compilación antes de ejecutar.
2. Dos formulaciones de R1 no compilaban, porque TypeScript estrecha los tipos. La tercera sí. |

## Entorno

Tras un reinicio de la app, la sesión dejó de cargar `~/.zshrc`. `pnpm` desapareció del `PATH` y `node` pasó a ser la v24.1.0 de `/usr/local/bin`. Las órdenes de esta etapa anteponen `~/Library/pnpm/bin`, con lo que se usan las mismas versiones que en E1–E4 (Node v26.9.0, pnpm 12.5.1). La carpeta temporal de scripts también se vació y se recrearon.

## Consecuencias y continuidad

- **El umbral de la política lo fija el operador:** no hay valor por defecto, y queda pendiente acordarlo con el piloto (docs-diagrams/08).
- **Reaprobar:** si cambian el motor o el perfil, todas las actualizaciones terminan `needs_review` hasta que el operador vuelva a aprobar la política.
- **Siguiente:** E6 (programación diaria).
