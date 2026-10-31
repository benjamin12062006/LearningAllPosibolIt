# 03 — Importar CSV y conservar snapshots completos

Fecha de creación: 2026-10-25  
Última actualización: 2026-10-26  
Estado: C1–C3 implementados y verificados localmente; migración remota y validación del volumen de despliegue pendientes. Operación inicial de una instancia.  
Ámbito: RF02/UC02, RF07, RNF01, RNF04 y RNF05.  
Relacionada con: [plan general](01-plan-projects-y-catalog-import.md), [prerrequisito projects](02-plan-projects.md), [fuentes técnicas](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md), [cursos y reconstrucciones ejecutadas](../../../fonts/feature/projects&catalog-import/03-cursos-y-reconstrucciones-catalog-import.md), [secuencias objetivo](../../../../../docs-diagrams/08-secuencias-y-estados.md).  
Revisión de referencia: `a551ed8`, con cambios locales previos; ver plan general.

## Objetivo y prerrequisito

Importar un CSV privado en un proyecto propio y configurado, conservando valores originales e identificadores textuales. El resultado será un snapshot inmutable `ready` y un trabajo `succeeded`, o un fallo explícito sin filas parciales utilizables. Requiere P1 de projects y su resolución autorizada por ID.

No aplica reglas, no convierte precios y no decide si un producto es aceptable para Google. Cargar una entrada y evaluarla son operaciones distintas.

## Qué se recuperó del curso y cómo cambia este plan

Se ejecutó `reconstruir-cursos-con-scripts` sobre tres lecciones de Fernando Herrera, conservando una receta/guía por original. `verify` confirmó tres guías y seis originales/contextos; después se instalaron junto a sus transcripciones. La [ficha de ejecución](../../../fonts/feature/projects&catalog-import/03-cursos-y-reconstrucciones-catalog-import.md) enlaza originales, guías, recetas, localizadores y manifiesto. Esa verificación acredita artefactos y procedencia; no ejecuta Nest, TypeORM ni el importador.

| Evidencia del curso | Mecanismo recuperado | Adaptación propia al catálogo |
| --- | --- | --- |
| RC1 — lección 155, fases 1–3, E1–E10 | `FileInterceptor('file')`, `UploadedFile` y filtro; rechazar con callback false puede dejar el archivo ausente sin excepción HTTP. | Exigir un único archivo y mapear su ausencia/rechazo a error estable. El CSV se valida por contenido, no por la lista de MIME de imágenes del curso. |
| RC2 — lección 157, fases 1–3, E1–E9 | Nombre generado con UUID, configuración de storage y distinción entre ruta de disco y URL pública. | Clave interna independiente de nombre/body del cliente, almacenamiento privado y prueba de no sobrescritura. No copiar `static/products` como destino público ni convertir una ruta local en respuesta API. |
| RC3 — lección 145, fases 1–3, E1–E10 | Escrituras relacionadas bajo un mismo manager; commit/rollback y liberación. | Usar transacciones cortas de Prisma v7; todas las consultas atómicas usan su `tx`. No introducir TypeORM ni QueryRunner en esta API. |

La lección 145 solo permite recuperar el método `update`, con la clase y métodos heredados incompletos. Las guías de carga conservan las limitaciones del ejemplo de imágenes. No se atribuyen al instructor el parser CSV, snapshots, estados, jobs, leases, privacidad por propietario o compensación entre archivo y SQL: son diseño de este producto, contrastado con las fuentes técnicas.

## Responsabilidades de CatalogImportModule

| Pieza prevista | Responsabilidad | Límite |
| --- | --- | --- |
| `CatalogImportController` y DTO | POST multipart y GET de estado/muestra; contrato HTTP y errores de entrada. | No parsear todo el catálogo ni devolver objetos Multer/Prisma. |
| Guard de acceso al proyecto | Después de Descope, resolver proyecto propio/configurado mediante ProjectsService antes del interceptor de carga. | Usar parámetros de ruta e identidad; los campos multipart aún no están disponibles. |
| Recepción y limpieza de carga | Crear temporal privado, acotar multipart y retirar archivos de la request que no fueron aceptados. | Cubrir fallos de interceptor, pipes, controller y servicio, no solo un `try/catch` dentro del controlador. |
| `CatalogImportService` | Coordinar aceptación, archivo final y alta atómica de snapshot/trabajo. | La aceptación no significa que el CSV ya esté parseado. |
| `CatalogImportRepository` | Operaciones atómicas `accept`, `claim`, `appendBatch`, `complete`, `fail` y lecturas autorizadas; nombres finales al implementar. | Prisma/SQL y manejo de `tx` quedan encapsulados. No crear un repositorio genérico. |
| Parser CSV | Decodificar/leer registros y validar estructura/IDs sin depender de Nest, Prisma o rutas. | Produce registros o error; no escribe estado por sí mismo. |
| Trabajador de importación | Consumir un job, esperar escritura de lotes y completar/fallar snapshot y job. | Concurrencia inicial 1 y una instancia, sin tareas iniciadas que no se esperan. |
| `ArtifactStore` | Temporal/finalización/lectura privada por clave interna y retirada segura cuando no hay referencia. | No publica URLs ni acepta rutas aportadas por cliente. |

Se crearán estos proveedores/archivos al implementar el incremento que los consume. Proyectos exporta acceso; importación depende de proyectos, usuarios y la base existente. Las firmas internas anteriores describen responsabilidades, no código ya disponible.

## Contrato de entrada propuesto

`POST /api/v1/projects/:projectId/imports`, sesión Bearer, cuerpo `multipart/form-data` con exactamente un `file`, `idColumn` obligatorio y `delimiter` opcional (`comma` por defecto o `semicolon` explícito). El servidor autentica y verifica propiedad/configuración antes de almacenar contenido. El nombre original solo es metadato sanitizado; nunca determina una ruta.

El orden será Descope → acceso/configuración del proyecto → interceptor de recepción → validación de campos → servicio. El pipe global de DTO corre después de la recepción multipart; un DTO inválido puede dejar un temporal aunque el controlador no se ejecute. La envoltura de carga debe capturar ese fallo y limpiarlo. Es una adaptación fundada en el ciclo de Nest y los límites de RC1, no una garantía de limpieza automática del framework. [F13/F15](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md).

Valores iniciales explícitos del transporte: `files: 1`, `fields: 2`, `parts: 3`, `fileSize: 10_485_760`, `fieldNameSize: 64` y `fieldSize: 512` bytes; confirmar semántica y límites en la versión Multer instalada al implementar. `idColumn` escalar de 1–128 caracteres y `delimiter` enum; rechazar arrays, campos repetidos, campos desconocidos y segundo archivo. El lockfile inspeccionado contiene Multer 2.4.0 transitivo; no se copiaron opciones nuevas de la rama principal del proveedor sin verificar esa versión.

Los campos pueden llegar antes o después del archivo. No usar `req.body.idColumn` o `delimiter` para `destination`, `filename`, permisos o lectura del CSV durante el callback de storage. Elegir clave/destino usando configuración del servidor y contexto autorizado; validar el body completo al terminar multipart. No exigir al cliente un orden de partes para que los permisos funcionen. [F13](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md).

Reglas iniciales, propuestas propias para acotar el prototipo:

- CSV UTF-8 estricto; aceptar BOM UTF-8. Rechazar secuencias inválidas, archivo vacío o solo cabeceras. No convertir automáticamente otras codificaciones.
- Máximo 10 MiB de archivo (10.485.760 bytes), 5.000 registros de datos y 200 columnas. Propuesta de `max_record_size`: 1.048.576 caracteres de buffer del parser, no bytes de archivo; probar ambas unidades y registrar el límite efectivo con la versión fijada. La cabecera no cuenta como producto. Los límites se validan mientras se recibe/procesa, no después de acumular el archivo completo.
- Primera fila de cabeceras no vacías, únicas y de hasta 128 caracteres por nombre. Conservar su texto salvo BOM; rechazar encabezados ambiguos en vez de sobrescribir columnas. `idColumn` debe coincidir exactamente con una cabecera.
- Todas las filas tienen el número esperado de campos; respetar comillas, comillas escapadas y saltos dentro de un campo. Admitir LF y CRLF; no usar `split('\n')` ni `split(',')`.
- Conservar valores como cadenas, incluidos `000123`, espacios y números con separadores. No activar cast de números/fechas ni trim global. Un ID vacío o compuesto solo de espacios invalida el snapshot; los demás IDs se comparan por su valor textual exacto dentro del snapshot. No normalizar o fusionar silenciosamente identificadores.
- Líneas completamente vacías pueden omitirse de forma explícita; una fila con separadores y campos vacíos sí es un registro y se valida. `sourceRow` es el ordinal lógico del registro de datos, empezando en 1; no equivale a línea física si hay saltos entre comillas.

`csv-parse` es candidato, pendiente de instalar y fijar su versión. Sus opciones permiten controlar BOM, casting y límites; la política anterior y la validación UTF-8 estricta son responsabilidad de nuestra implementación. [F8](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md).

La propuesta de parser usa registros como arrays (`columns: false`) hasta validar cabeceras y anchura; después construye `original_values` con claves propias seguras, sin fusionar campos del CSV en opciones o prototipos. Conservar `cast: false`, `cast_date: false` y trim desactivado. El decodificador UTF-8 debe fallar ante bytes inválidos, mantener secuencias multibyte entre chunks y comprobar el final del stream; seleccionar la técnica compatible con Node 24 y probarla antes de afirmar UTF-8 estricto. Un reemplazo silencioso por `�` no satisface el contrato. [F8/F16](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md).

Persistir lotes esperando cada escritura, con propuesta inicial de hasta 250 filas o 1 MiB de valores serializados por lote, el primero que se alcance. Si una fila supera el presupuesto de lote pero respeta el límite de registro/archivo, escribirla sola; nunca acumular una cola de promesas de todo el catálogo. Ajustar estos valores tras medir. El worker compara cantidad persistida y checksum leído antes de `ready`, conservando el ordinal lógico de datos. Estas son decisiones propias pendientes de prueba.

## Modelo mínimo y estados

| Tabla propuesta | Campos y restricciones mínimas |
| --- | --- |
| `catalog_snapshots` | ID textual generado, `project_id` FK a la tabla física de proyectos, `id_column`, delimitador, encabezados, `source_hash`, `artifact_key`, tamaño, estado, conteo final, fecha y error público cuando proceda. |
| `catalog_rows` | `snapshot_id` FK, `source_row` entero positivo, `external_id TEXT`, `original_values JSONB` con valores de texto. `UNIQUE(snapshot_id, external_id)` y `UNIQUE(snapshot_id, source_row)`. |
| `catalog_import_jobs` | ID, `project_id`, `snapshot_id`, estado, progreso y fechas; `UNIQUE(snapshot_id)` para un trabajo inicial por snapshot; error estable. Una FK compuesta o restricción equivalente debe impedir asociar el trabajo a un snapshot de otro proyecto. |

Todas se crean en `estadistica_forms` mediante migración nueva. Para la FK compuesta se necesita también una clave única `(project_id, id)` en snapshots. Los nombres finales Prisma/SQL se fijarán al implementar. El trabajo es específico de importación; no construir una cola genérica antes de tener otros consumidores.

Snapshot: `pending → importing → ready` o `failed`. Trabajo A: `queued → running → succeeded` o `failed`. Los estados iniciales son persistidos; las filas pueden guardarse por lotes mientras el snapshot no está listo. Solo `ready` permite muestra, lectura de filas y futura evaluación. Un fallo puede conservar filas parciales privadas para diagnóstico/limpieza, pero ninguna consulta de contenido las devuelve. Las FK y unicidad respaldan persistencia; no sustituyen acceso por propietario. [F6](../../../fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md).

`pending` corresponde a job `queued`; `importing`, a `running`; `ready`, a `succeeded`; ambos recursos pasan juntos a `failed` al cerrar un fallo. El reclamo actualiza snapshot/job en una sola transacción condicional. El conteo final queda nulo hasta `ready`; `processedRows` del job es progreso, no un conteo confirmado. Al fallar, registrar un error primario acotado (`code`, mensaje público, ordinal/campo cuando existan), sin guardar en ese mensaje filas completas. Un informe de múltiples problemas comerciales pertenece a evaluación posterior.

## Recorrido y límites transaccionales

1. Guard Descope y servicio de proyectos resuelven propietario, proyecto y configuración. Errores de sesión/propiedad se resuelven antes de recibir el archivo en almacenamiento de la feature.
2. Recibir en almacenamiento temporal privado con límites multipart de archivo, campos y cantidad de partes; validar body completo, calcular SHA-256, finalizar bajo una clave interna y registrar bytes. Configurar almacenamiento explícito: no asumir que FileInterceptor sin opciones crea un temporal en disco. No usar directorios públicos ni `MemoryStorage` para el archivo entero.
3. Revalidar propiedad/configuración y crear snapshot `pending` + trabajo `queued` en una transacción corta. Coordinar con PATCH de configuración mediante bloqueo de la fila del proyecto en ambos caminos: o el PATCH termina antes y la importación usa esa configuración, o el snapshot ya existe y el PATCH queda bloqueado por política. Nada de `await` de disco dentro de esta transacción.
4. Responder `202 { snapshotId, jobId, status: "queued", statusUrl }` solo después de confirmar el commit. `statusUrl` será relativa bajo `/api/v1/projects/.../jobs/...`. Si se confirma que no hubo registro, retirar el archivo no referenciado o dejarlo para conciliación documentada; si el resultado del commit es incierto, conservarlo hasta comprobar referencias. No devolver `202` sin aceptación confirmada.
5. El trabajador local con concurrencia 1 toma el trabajo mediante actualización condicional `queued → running`. Cambia snapshot a `importing`, lee por stream, valida cabeceras/filas y persiste lotes acotados.
6. Al terminar, verificar conteo e integridad. Una transacción corta cambia snapshot a `ready` y trabajo a `succeeded`, con conteo y fecha final. Si falla el commit no se devuelve éxito ni se habilita contenido.
7. Un error de parseo, ID o límite cambia snapshot y trabajo a `failed`, con código y localizador seguro del problema. No registrar catálogo completo o valores sensibles en logs. Error SQL técnico queda en logs sanitizados.

Esta separación adapta la recepción multipart de [Nest](https://docs.nestjs.com/techniques/file-upload) y la atomicidad de [PostgreSQL](https://www.postgresql.org/docs/current/tutorial-transactions.html): el archivo y SQL no comparten una transacción. El claim y las transacciones de lotes/finalización se verifican con los repositorios reales antes de dar el incremento por cerrado.

Usar `$transaction(async tx => ...)` de Prisma v7 para las operaciones condicionales y ejecutar dentro de ese `tx` todas las consultas que forman la unidad atómica. Los helpers del repositorio no deben volver al cliente global a mitad del bloque. El alta, el reclamo, la finalización y el registro de fallo son transacciones pequeñas separadas; el parseo completo y el disco quedan fuera. Un error revierte esa transacción SQL; no borra lotes ya confirmados ni revierte un commit anterior. No crear/cerrar otro pool por importación: reutilizar el `PrismaService` actual. [RC3/F14](../../../fonts/feature/projects&catalog-import/03-cursos-y-reconstrucciones-catalog-import.md).

Si un lote falla, cerrar su transacción antes de intentar marcar snapshot/job `failed` en otra; una transacción PostgreSQL abortada no sirve para registrar después el error. Si el registro del fallo tampoco puede persistirse, reconciliar al reiniciar. La lectura posterior al commit no debe convertir un éxito confirmado en rollback ficticio.

## Propiedad del archivo y compensación

| Momento | Responsable | Qué hacer si falla |
| --- | --- | --- |
| Temporal en recepción | Envoltura de carga de esa request. | Al aborto, límite, multipart inválido o fallo de pipe, cerrar escritura y retirar solo su temporal. |
| Final completo; alta SQL aún no confirmada | Coordinación de aceptación. | Consultar referencia con IDs generados para esa aceptación; no borrar si el commit pudo aplicarse. |
| Snapshot/job confirmados | `ArtifactStore` referenciado por el snapshot. | Un corte de respuesta HTTP no autoriza al `finally` de la request a borrar el archivo. El job puede continuar. |
| Snapshot fallido | Política de retención/conciliación. | Conservar privado para diagnóstico; limpiar solo por referencia/antigüedad y sin cargas activas que lo estén adoptando. |

Generar `snapshotId`, `jobId` y clave de artefacto antes de intentar el alta. Si se pierde la respuesta del commit, consultar esos mismos IDs bajo el proyecto/propietario y verificar la clave asociada. Si el alta existe, conservarla y devolver el resultado aceptado; si se confirma ausencia, compensar. Si la base sigue inaccesible, devolver error temporal y conservar el final como pendiente de conciliación; no asumir rollback ni borrarlo. No se promete idempotencia HTTP entre peticiones distintas: un reintento del cliente puede crear otro snapshot, como ya define el alcance A.

El almacenamiento local usará temporales y finales bajo un volumen privado controlado, con claves generadas y finalización sin sobrescritura. Probar una colisión forzada en vez de confiar solo en la probabilidad del UUID. No programar borrados automáticos antes de acordar retención; cualquier conciliación inicial será acotada, registrará su resultado y excluirá cargas activas. La semántica de durabilidad tras caída del sistema se verificará en el volumen elegido antes del piloto.

## Consultas autorizadas y errores

| Ruta o situación | Respuesta prevista |
| --- | --- |
| `GET /api/v1/projects/:projectId/jobs/:jobId` | `200 { job }` con estado, progreso, snapshot y error público si existe. |
| `GET /api/v1/projects/:projectId/imports/:snapshotId` | `200 { snapshot, sample }`; muestra máxima de 20 filas solo si `ready`, sin ruta interna del archivo. |
| Sesión ausente/inválida | `401`. |
| Proyecto ajeno o recurso de otro proyecto | `404`, comprobando tanto padre como hijo. |
| Configuración pendiente o cambio bloqueado | `409` con código estable. |
| Campos multipart inválidos/fichero ausente | `400`; sin trabajo aceptado. |
| Tamaño detectado durante recepción | `413 IMPORT_FILE_TOO_LARGE`; limpiar temporal, sin snapshot utilizable. |
| Parseo/ID/filas fallan tras `202` | Consultar trabajo: `200`, estado `failed`, código como `CSV_INVALID`, `CSV_INVALID_ENCODING`, `CSV_DUPLICATE_ID`, `CSV_ID_MISSING`, `CSV_COLUMN_MISSING` o `IMPORT_ROW_LIMIT`. |
| Dependencia falla antes del `202` | `503` cuando es temporal; sin confirmar aceptación. |

`job` expone ID, proyecto, snapshot, estado, filas procesadas, fechas y error público. El progreso de un trabajo activo es orientativo; el conteo definitivo corresponde al snapshot completo. Los errores de estas rutas incluirán `code`, `message` y `requestId`; el detalle de parseo puede añadir `sourceRow` y `field`, con tamaño acotado. Este contrato requerirá mapeo explícito de excepciones Nest en la feature. Repetir un POST crea una importación nueva; hash igual no implica reutilizar ni sobrescribir el snapshot previo. Idempotencia HTTP formal queda para B.

El archivo original no obtiene URL pública en este alcance. Si se añade descarga privada más adelante, deberá resolver sesión y propiedad por referencia interna; nunca aceptar una ruta de disco del cliente.

## Trabajador inicial, reinicio y almacenamiento

Un único proceso API/trabajador, una importación activa; streams/lotes para no retener el catálogo completo en memoria. El worker consulta trabajos persistidos, no depende solo de un evento en memoria. Durante cierre deja de reclamar, espera un tiempo acotado y registra interrupciones. Al arrancar, marca los `running` heredados y sus snapshots como `failed` con `IMPORT_INTERRUPTED`; después procesa los `queued` persistidos. Si la base está caída al registrar el fallo, el siguiente arranque lo reconcilia. El frontend nunca queda esperando indefinidamente un worker que ya murió.

Este reinicio presupone una sola instancia. No desplegar múltiples réplicas con esa rutina; leases, fencing, reintentos y recuperación concurrente corresponden a B. Un `queued` cuyo archivo ya no está disponible termina con error estable. El directorio de artefactos necesita volumen persistente antes de uso real, permisos privados y exclusión de Git. Su ruta de configuración se definirá en `.env.example` al implementar. Limpiar temporales al rechazar/abortar; conciliar huérfanos solo después de comprobar referencias y antigüedad. Definir retención antes de programar borrados automáticos.

## Incrementos de construcción

| Etapa | Cambios previstos | Evidencia de cierre |
| --- | --- | --- |
| C1 | DTO multipart, recepción privada, migraciones de snapshot/job, aceptación y consultas de estado. | `202` con IDs persistidos; `401/404/409/413`; rollback y temporales comprobados. |
| C2 | Parser, lotes, unicidad, muestra y finalización atómica. | CSV correcto `ready`; entradas inválidas `failed`; filas originales textuales. |
| C3 | Reconciliación al reiniciar, fallos de disco/DB y medición. | Sin contenido parcial visible, sin `running` huérfano, limpieza acotada y métricas registradas. |

Usar contratos pequeños para sustituir almacenamiento en pruebas; repositorio usa el `PrismaService` compartido. Probar fallos de forma controlada sin tocar archivos o datos de otras features. En C1, distinguir recepción completa de aceptación SQL; en C2, distinguir lotes escritos de snapshot listo; C3 cierra interrupciones y propiedad del archivo.

## Aceptación prevista

Fixtures: BOM, UTF-8 con acentos, bytes inválidos, delimitadores explícitos, LF/CRLF, comillas escapadas y saltos dentro del campo, cabecera duplicada/vacía, ID inexistente/vacío/duplicado, ceros iniciales, archivo vacío y cantidad desigual de columnas. Límites: 5.000/5.001 filas y archivo en/sobre 10 MiB; probar también una fila anormalmente grande para confirmar el límite del parser.

Integración: mismo ID externo en snapshots distintos es válido; duplicado en uno falla. Bob no consulta el job, snapshot o muestra de Alice, ni usa el ID de su snapshot bajo otro proyecto. Rechazar configuración pendiente antes de almacenar; forzar fallo después de un lote y confirmar que ningún consumidor ve contenido. Simular archivo finalizado con registro fallido, fallo de transacción final y reinicio durante `running`. Probar que PATCH concurrente y encolado no producen importación con configuración ambigua.

## Matriz de aceptación derivada de los mecanismos reconstruidos

| Caso | Resultado requerido | Dónde demostrarlo |
| --- | --- | --- |
| Campo file ausente, filtrado o con nombre inesperado | `400` estable y ninguna aceptación; no leer propiedades de undefined. | HTTP multipart real con Nest; RC1. |
| Cliente envía archivo antes de `idColumn`/`delimiter` | Mismo resultado que con campos antes del archivo; nombre/destino independientes del body incompleto. | HTTP, dos órdenes de partes; F13. |
| Segundo archivo, campo repetido/desconocido o DTO inválido | Rechazo y limpieza del temporal de esa request aunque no se ejecute controller. | HTTP + directorio temporal propio; F13/F15. |
| Dos cargas con igual originalname y colisión de clave forzada | Artefactos distintos; ante colisión controlada, ninguna sobrescritura. | Adaptador de archivos; RC2. |
| Archivo rotulado text/csv con contenido inválido | Job `failed` después de aceptar, sin `ready`; MIME no acredita CSV. | Parser/worker y consulta autorizada; RC1/F8. |
| Error de la segunda escritura del alta | Ni snapshot ni job parcial confirmado; compensación del archivo solo con ausencia conocida. | Integración SQL real; RC3/F14. |
| Corte de respuesta después del commit | Archivo conservado y aceptación recuperable por los mismos IDs. | Coordinación con fallo inyectado después de commit; adaptación propia. |
| Commit de alta indeterminado por desconexión | No borrar a ciegas; reconciliar referencia antes de retirar final. | Coordinación de error y consulta; no simularlo como rollback probado. |
| Fallo tras un lote confirmado o durante finalización | Datos parciales privados y snapshot no utilizable; no publicar `ready` sin job `succeeded`. | Integración de lotes/finalización; RC3/F6. |
| Caída y reinicio con trabajo running | Ambos recursos a failed/IMPORT_INTERRUPTED; queued permanece retomable. | Integración de reconciliación en una instancia. |

La suite HTTP conserva el guard real y controla la frontera Descope según el plan de testing. Para probar body inválido se usa identidad sintética válida; para probar acceso anónimo se espera `401` antes de almacenamiento, sin mezclarlo con validación de CSV. Los mocks verifican coordinación; las FK, unicidad y rollback se demuestran con Prisma/PostgreSQL temporal. No usar sleeps fijos para esperar el worker: observar estado terminal con timeout acotado.

Medir duración, memoria y latencia de la API con el límite elegido; registrar resultados, no atribuir rendimiento por usar Node/streams. Las pruebas nuevas siguen el [plan de testing Nest basado en Fernando Herrera](../../config/01-testing-nest-para-futuras-features.md): Jest y `@nestjs/testing`, Supertest para HTTP multipart/polling y PostgreSQL temporal para integración. Reconstruir/reutilizar las lecciones antes de adaptar código. Los tests actuales y su runner Node permanecen como regresión sin reescritura. La concurrencia de múltiples procesos sobre Cloud SQL se verificará al preparar B.

## Cierre y continuidad

Completar la siguiente entrada de bitácora del incremento con archivos, decisiones y pruebas realmente ejecutadas. Con el importador verificado, pasar a versiones de mapeo/reglas y evaluación. No crear tablas de reglas/feed ni construir un motor universal en esta etapa.

## Ejecución del 2026-10-26

Implementación en `src/catalog-import`: almacenamiento privado, DTO/interceptor, guard de proyecto, repositorio, parser, worker y filtro de errores acotado a la feature. Migración `20261026000100_create_catalog_import`. Aceptación y PATCH comparten el bloqueo de fila del proyecto; snapshot conserva la configuración utilizada.

Se eligieron csv-parse 7.0.3 y Multer 2.4.0 con tipos directos. El storage engine propio controla escritura, sincronización y limpieza. El parser valida el ancho de cada array de campos: `relax_column_count` permite recibirlo para esa comprobación, sin aceptar filas desiguales.

Con `max_record_size: 1_048_576` el buffer UTF-8 rechazó 600.000 caracteres `é` y aceptó 600.000 ASCII en la versión instalada. El límite de este caso se comporta en bytes del buffer; no se promete un millón de caracteres Unicode por registro. El archivo tiene un máximo separado e inclusivo de 10.485.760 bytes, verificado también por HTTP.

El cierre usa `onModuleDestroy` antes de cerrar el PrismaService importado, con espera acotada y aborto al vencer el plazo. El orden se verificó al cerrar Nest. Running heredados pasan a failed/IMPORT_INTERRUPTED al reiniciar y queued se retoman. No hay borrado automático de finales: una política de retención posterior requiere decisión explícita y consulta de referencias.

Resultados y pendientes operativos: [bitácora 03](../../../../bitacora-construccion/feature/projects&catalog-import/03-implementar-catalog-import.md). Cadena de fuentes: [fuente 05](../../../fonts/feature/projects&catalog-import/05-implementacion-catalog-import.md). Peticiones: [catalog-import.http](../../../../requests/catalog-import.http).

Sigue el backend: [ajustes de límites](04-plan-ajustes-limites-y-consultas.md). El [plan bilingüe](../../config/02-mensajes-y-errores-bilingues-es-en.md) permanece pendiente de orden independiente.
