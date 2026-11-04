# 04 — Mapa de necesidades y fuentes para el plan de feeds y publicaciones

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-02 (plan 01 escrito: cada N tiene su D)  
Estado: Investigación cerrada; decisiones en el [plan 01](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), implementado entero (E1–E7, 2026-11-04).  
Tipo de fuente: elaboración propia a partir de las fichas 01–03.  
Origen: código actual, `docs-diagrams`, cursos reconstruidos y documentación oficial.  
Fecha de consulta: 2026-11-02  
Revisión del proyecto: `f6b4bf9` con cambios sin commit (ficha 01).  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md), [plan 01](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), carpeta de bitácora `bitacora-construccion/feature/feeds&publications/` (vacía).

## Propósito

Índice para escribir el plan sin repetir la búsqueda, con el formato **Necesidad → requisito → fuentes → decisión pendiente**. Los `F` remiten a las fichas 01–02 y los `C`/`RC`, a la ficha 03.

## Necesidad → requisito → fuentes → decisión pendiente

| # | Necesidad | Requisito | Fuentes | Decisión que debe tomar el plan |
| --- | --- | --- | --- | --- |
| N1 | Alcance y orden | Incremento 5: URL, publicación, programación, recuperación y alertas | F1, F6, hallazgo 7 | ¿Una feature con etapas o dos (primero publicación y URL; después fuente remota, programación y recuperación)? Orden propuesto a valorar: trabajos durables → feed y publicación manual → URL pública → fuente remota → programación y política → estado y alertas. |
| N2 | Trabajos durables | Lease, token de ejecución, intentos, `retry_wait`, idempotencia | F3–F5, F7–F10, F17, F18, RC1, RC4, C6 | ¿Tabla `jobs` común para los trabajos nuevos, o columnas nuevas en `catalog_import_jobs` y `evaluations`? ¿Se migran importación y evaluación a la recuperación con lease y se retira `interruptRunning` (hallazgo 1), o conviven? Duración del lease, frecuencia de renovación y reloj usado (`now()` de la base de datos frente al del proceso). |
| N3 | Terminar solo con el token vigente | «Dos trabajadores no publican con lease vencido» | F6, F18, RC1, hallazgo 2 | Todas las escrituras del worker condicionadas a `execution_token`; recuperar un trabajo genera un token nuevo. Prueba secuencial en PGlite: reclamar, vencer, recuperar e intentar terminar con el token viejo (hallazgo 6). |
| N4 | Reintentos | Espera creciente con máximo; errores de datos sin reintento | F5, RC4, C6 | Fórmula de espera (base, factor, tope), máximo de intentos y qué errores son temporales (red, 5xx, tiempo agotado) frente a definitivos (CSV inválido, límites). |
| N5 | Feed y versiones | `feed` con puntero, generación y política; `feed_version` con evaluación, archivo, checksum y fecha | F3, F11, hallazgo 3 | ¿`feed_version` apunta a una `Export` existente (mismo archivo y aprobación) o copia su archivo? ¿Un feed por proyecto (un canal Google) o varios? Qué ocurre con el feed al borrar un proyecto o una importación (las exportaciones ya se borran en cascada). |
| N6 | Publicar | `POST …/feeds/{feed_id}/publications` con generación esperada; conflicto → la versión vigente no cambia | F4, F5, F18, RC1 | Cuerpo (`exportId` o `evaluationId` + `expectedGeneration`); respuesta y códigos (`409` de generación, aprobación o evaluación no exportable). ¿Publicar crea la exportación si no existe? |
| N7 | URL pública estable | `GET /feeds/{delivery_token}.tsv`, token revocable, fuera de la sesión | F2, F4, F13, F19, F24, F25, C8, hallazgo 4 | Formato del token (32 bytes `base64url`), guardar solo su SHA-256, rotar y revocar; misma respuesta `404` para inexistente y revocado; `exclude` del prefijo y ruta sin versión; ¿se registra el acceso (sin token completo en logs, RNF05)? ¿Limitar peticiones (no hay `Throttler`)? |
| N8 | Caché de la URL | Servir siempre la versión vigente completa | F23, C7, F5 | `ETag` = checksum de la versión y `304` con `If-None-Match`; `Cache-Control` (`no-cache` frente a `max-age` corto). Una lectura iniciada puede terminar con la versión anterior (docs-diagrams/08): el archivo anterior se conserva mientras esté referenciado. |
| N9 | Fuente CSV por URL | `CatalogSource` remoto; mismo resultado que la subida | F4, F12, F21, F22, C5, hallazgo 5 | Solo `https`; resolver y rechazar destinos no públicos; conectar a la IP validada; sin redirecciones; tiempo límite y límite de 10 MiB durante la descarga; ¿credenciales (Basic) ahora o después, y cómo se guardan? Pendiente: documentación de `undici`/`http` para fijar la IP (vacío de la ficha 02). |
| N10 | Programación | Actualización diaria de una fuente autorizada | F15, F16, RC2, RC3, F20 | `@nestjs/schedule` (12.0.2) frente al `setInterval` actual; un tick que busca proyectos con ejecución pendiente frente a un `CronJob` por proyecto; hora y zona horaria por proyecto; clave única por ejecución programada para que varias instancias no dupliquen (F15). |
| N11 | Política aprobada | Actualizar solo si se cumple; si no, pendiente de revisión y se conserva la publicación | F5 | Qué se fija al aprobar: revisión de reglas, versión del perfil y del motor, exclusiones permitidas y límite de caída de productos (umbral a acordar con el piloto, «no una cifra oculta»). ¿Reaprobar cuando cambian motor o perfil? |
| N12 | Estado y alertas | Mostrar fecha, fallos y versión publicada | F2, F1 | ¿«Alerta» es solo estado consultable (`GET` del feed con última publicación, último intento y error público) o también un aviso activo (correo, webhook)? Docs-diagrams/05 solo exige mostrar. |
| N13 | Errores públicos | Contrato bilingüe actual | F13, `messages.ts` | Códigos nuevos (generación en conflicto, fuente no permitida, descarga fallida o demasiado grande, política no cumplida, feed no encontrado) con textos es/en y `CODES_WITH_ISSUES` cuando corresponda. |
| N14 | Limpieza | Archivos solo mientras estén referenciados | F3, F11 | Retención de versiones antiguas del feed; reutilizar `removeOrphans`; borrar o revocar al borrar un proyecto. |
| N15 | Pruebas | Unitarias, integración PGlite, E2E con dos propietarios | F6, F8, F14, hallazgo 6 | Qué se demuestra en PGlite (token, generación, idempotencia en secuencia) y qué queda «No verificado» (concurrencia real entre procesos, descarga de Merchant Center). ¿Un servidor HTTP local en las pruebas de la fuente remota, con direcciones privadas permitidas solo en pruebas? |

## Vacíos sin fuente suficiente

- Fijar la IP resuelta con el cliente HTTP de Node (`undici` o `http.request` con `lookup`): no consultado.
- Comportamiento real de la descarga de Merchant Center (tiempos, reintentos, `ETag`): sin documentación oficial; se verá en el piloto.
- Umbral de caída de productos de la política: decisión del piloto.
- Concurrencia entre procesos: PGlite no la demuestra (F6); el proyecto no tiene todavía un PostgreSQL local de pruebas.

## Siguiente paso

Hecho el 2026-11-02: [plan 01](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md), con una decisión `D` por cada `N` y siete etapas. El vacío sobre cómo fijar la IP en Node se resuelve en su E3.
