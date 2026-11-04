# 01 — Evidencia para los reintentos de E4

Fecha de creación: 2026-11-02  
Tipo de fuente: curso local, reconstrucción derivada y plan vigente.  
Relacionada con: [plan](../../../plans/feature/feed-refresh/01-e4-trabajos-y-reintentos.md).

## Fuentes consultadas

- F1: [plan principal](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), D2–D4, D9, D13 y etapa E4. Exige espera base 60 s, tope 15 min, máximo 3 y persistencia de run_after.
- F2: [87. Implementing Message Retries](</Users/benji/Documents/chrome-extencions/trancripciones/Go/Building, scaling and deploying distributed systems in Golang and Kubernetes/Sección 14 Reliability/87. Implementing Message Retries.md>), sección 14 Reliability, párrafos «config dot max retries» y «one second after two seconds». Instructor no identificado en los metadatos leídos.
- R1: [reconstrucción de 87](</Users/benji/Documents/chrome-extencions/trancripciones/Go/Building, scaling and deploying distributed systems in Golang and Kubernetes/Sección 14 Reliability/87. Implementing Message Retries - Reconstrucción guiada.md>), fases 1–3 y fragmento WithBackoff. El curso muestra el consumidor y esperas, no la implementación del paquete retry.

## Evidencia, interpretación y adaptación

F2/R1 muestran reintentos limitados y confirmación tras éxito; no muestran leases SQL ni esta fórmula TypeScript. La fórmula y la clasificación se implementan como propuesta propia conforme a F1. Se devuelve una duración sin dormir; el futuro repositorio persistirá run_after. Un error de ocupación es una espera de coordinación, no un fallo que agote intentos. Los errores de etapas conservan su causa antes de clasificarse.

No se copia el cron de otras lecciones: el usuario corrigió el alcance a E4, no E6. No se añadieron paquetes ni se ejecutó código del curso.
