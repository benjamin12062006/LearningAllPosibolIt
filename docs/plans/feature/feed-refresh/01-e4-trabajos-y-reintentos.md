# 01 — E4: trabajos de actualización y reintentos

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-05 (cierre)  
Estado: **Cerrado, absorbido en E4 de feeds&publications.** Solo se llegó a hacer el incremento 1 (`src/jobs/refresh-retry.ts` y su prueba). E4 lo reutilizó y construyó el resto (persistencia, lease, pasos, worker y rutas): ver la [bitácora 04](../../../../bitacora-construccion/feature/feeds&publications/04-trabajo-de-actualizacion-con-lease.md). Se conserva como registro; no queda trabajo pendiente aquí.  
Revisión de partida: f6b4bf9, con E1/E2 locales de Claude.  
Relacionada con: [plan principal, D2–D4 y E4](../feeds&publications/01-plan-feeds-y-publicaciones.md), [fuentes](../../../fonts/feature/feed-refresh/01-reintentos-y-contratos.md), [bitácora](../../../../bitacora-construccion/feature/feed-refresh/01-politica-de-reintentos.md).

## Alcance y coordinación

El usuario asigna E3 a Claude y E4 a este chat. No se edita el plan principal ni los módulos feeds, remote-source, artifacts, catalog-import o sus pruebas mientras Claude los modifica. Compilación y defectos se ejecutan en una salida temporal independiente de `.test-build` y `dist`.

## Incrementos

1. Implementar las decisiones puras D4: espera exponencial limitada, clasificación y decisión de recuperación. Errores de ocupación esperan sin consumir intentos; datos inválidos terminan; los errores temporales tienen máximo. Sin temporizadores, reloj global ni dependencia HTTP.
2. Añadir persistencia `feed_refreshes`, FK/índice activo, reclamación con SKIP LOCKED, expiración y token. Toda escritura exige token vigente y lease aún no expirado; comprobar solo token es insuficiente antes de que otro worker lo reclame. Reloj SQL y updates condicionales.
3. Conectar `fetch → import → evaluate` al contrato real de E3; snapshot/job/evaluation IDs persistidos antes del efecto y reconciliación al recuperar. `IMPORT_INTERRUPTED`/`EVALUATION_INTERRUPTED` se clasifican antes de convertirlos a fallo genérico de etapa.
4. Endpoints autenticados de disparo/consulta, worker/apagado, migración Prisma y pruebas de aislamiento y recuperación. Incorporar cambios compartidos cuando E3 tenga su contrato estable.

## Contrato de los reintentos

`attempt` cuenta fallos consumidos (empieza en 1 al primer fallo). Máximo 3 significa dos reintentos tras el primer intento; el tercer fallo termina. Cambiar de stage o esperar un trabajo ocupado no consume intentos. La recuperación de un lease vencido cuenta como fallo temporal. `delayMs` se transforma en `run_after` usando el reloj SQL, nunca el reloj del cliente.

El adaptador pasa `{ code, httpStatus? }`, sin textos/URLs/secretos. `SOURCE_HTTP_ERROR` necesita el HTTP del origen, no el código HTTP de Nest. Si falta, tratar como fallo temporal acotado para no atribuirle un 4xx inventado. La lista de códigos se basa en D13; se adaptará a E3 si su contrato final difiere.

## Verificación

Unitarias Jest de fronteras, errores definitivos, ocupación, HTTP 429/5xx/4xx y límites de configuración. Defectos introducidos solo en copia temporal. E4 completa exige además integración PostgreSQL/PGlite, token viejo sin efectos, idempotencia de los pasos, E2E y arranque real. Las unitarias no acreditan esas garantías.
