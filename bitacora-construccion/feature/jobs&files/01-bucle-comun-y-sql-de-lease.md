# 01 — Bucle común de los workers y SQL de lease (E1)

Fecha de creación: 2026-11-05  
Estado: Implementado y verificado en local. Sin migración.  
Ámbito: etapa E1 del [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md) (D2, D3).  
Relacionada con: [plan 01](../../../docs/plans/feature/jobs&files/01-plan-ejecucion-y-archivos.md), fichas [01](../../../docs/fonts/feature/jobs&files/01-estado-real-y-antecedentes.md) (E1, E4) y [02](../../../docs/fonts/feature/jobs&files/02-fuentes-tecnicas-y-cursos.md) (F3, F7).  
Revisión de partida: `612b745` (`feature/feeds-publications`), con cambios sin commit de organizaciones y hojas de cálculo.

## Necesidad

Los tres workers (importación, evaluación y actualización del feed) repiten el mismo bucle: temporizador, `wake`, `runUntilIdle` y apagado con espera y aborto. Las etapas E2 y E3 van a cambiar ese bucle en dos de ellos. Antes, se saca a un único sitio, sin cambiar el comportamiento, y el SQL de lease de feeds pasa a ser común.

## Evidencia y decisiones

| Decisión | Evidencia | Aplicación |
| --- | --- | --- |
| Composición, no herencia (D2) | Regla 5 de `filosofia-codigo-legible-para-humano`: estado más operaciones → un objeto pequeño | [`src/jobs/worker-loop.ts`](../../../src/jobs/worker-loop.ts): `WorkerLoop` con `start`, `wake`, `runUntilIdle`, `isStopping`, `runJob` y `stop`. Cada worker crea el suyo en el constructor y le pasa su pasada. |
| El apagado espera a que la pasada registre el aborto | Comportamiento ya probado de feeds (ficha 01, E4); F7 | `stop()` aborta tras `shutdownMs` y **espera** a la pasada, y devuelve `{ aborted }` para que importación y evaluación sigan llamando a `interruptRunning` en esta etapa. |
| SQL de lease común (D3) | E4, F3 | [`src/jobs/lease-sql.ts`](../../../src/jobs/lease-sql.ts): `JobClaim`, `newExecutionToken`, `nowPlus` y `claimIsCurrent`, sobre las columnas comunes sin alias. Feeds los importa y borra sus copias. |

### Ajustes al escribir el código

- **El token sigue siendo un UUID** (`randomUUID`), como en feeds, y no 32 bytes `base64url` como decía D3. Su papel es ser único e imprevisible por reclamo, y un UUID v4 lo cumple. Anotado en el plan.
- **Diferencia de tiempos en el apagado de importación y evaluación**: antes, tras abortar, llamaban a `interruptRunning` sin esperar a que el trabajo terminara; ahora esperan a la pasada, como ya hacía feeds. El resultado es el mismo (el trabajo abortado ya se registraba como `IMPORT_INTERRUPTED`), pero ninguna escritura queda en vuelo al cerrar la conexión.

## Comprobación

| Comprobación | Resultado |
| --- | --- |
| Batería completa sin tocar aserciones (oráculo del refactor) | 63 suites y 1.106 pruebas en verde (incluye las de las sesiones de organizaciones y hojas). |
| Pruebas nuevas | 8 unitarias de `WorkerLoop`: una pasada compartida, pasada nueva al terminar, sin arranque automático, fallo de la pasada avisado, apagado sin aborto, aborto tras `shutdownMs` con espera, señal abortada al empezar durante el apagado y nada después de `stop`. |
| `tsc --noEmit`, `pnpm lint`, `prettier --check` | Sin errores. |
| Defectos a propósito (copia temporal del repositorio) | 5 de 5 detectados. |

Los defectos fueron:

- W1, `runUntilIdle` no comparte la pasada;
- W2, el apagado no aborta;
- W3, `runJob` no aborta durante el apagado;
- W4, `claimIsCurrent` sin comprobar el lease: falla una prueba de integración de feeds;
- W5, la importación sigue reclamando tras el apagado: bucle infinito, y Jest se queda sin memoria en la prueba de cierre del worker.

**Incidencia:** el script de defectos solo miraba la línea `Tests:` y dio W5 por «no detectado», cuando la suite había fallado por memoria (`Test Suites: 1 failed`). Se corrigió para mirar las dos líneas.

## Consecuencias

- Las etapas E2 y E3 cambian el bucle en un solo sitio y añaden la recuperación de leases a la pasada de importación y evaluación.
- No hay migración ni cambio de contrato.
