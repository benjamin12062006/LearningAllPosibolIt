# 02 — Fuentes técnicas para migración e importación CSV

Fecha de creación: 2026-10-25  
Tipo de fuente: documentación oficial y propuestas propias.  
Origen: Prisma ORM v7, PostgreSQL, NestJS y CSV Parse.  
Fecha de consulta: 2026-10-25  
Relacionada con: [antecedentes](01-estado-real-y-antecedentes.md), [cursos y guías generadas](03-cursos-y-reconstrucciones-catalog-import.md), [projects](../../../plans/feature/projects&catalog-import/02-plan-projects.md), [catalog-import](../../../plans/feature/projects&catalog-import/03-plan-catalog-import.md), [registro de fuentes global](../../../../../docs-diagrams/04-fuentes-y-validacion.md).

## Necesidades y evidencia

| ID | Fuente directa y localizador | Evidencia y aplicación |
| --- | --- | --- |
| F4 | [Prisma ORM v7: Customizing migrations](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations), How to edit a migration file, Rename a field, expand and contract | Permite revisar el SQL de una migración nueva y preservar datos al renombrar. Adaptación final de Plan 02: renombrar tabla/índice/restricciones a projects y añadir configuración, conservando filas y SQL histórico aplicado. Sustituye la propuesta inicial de mantener el nombre físico anterior. |
| F5 | [PostgreSQL: Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html), 3.4 | Agrupa cambios de base como unidad atómica. Adaptación: snapshot/job juntos y finalización conjunta; archivos privados se finalizan fuera de SQL. No implica atomicidad entre disco y base. |
| F6 | [PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html), 5.5.1 CHECK, 5.5.3 UNIQUE, 5.5.5 Foreign keys | Restricciones sobre valores, unicidad y referencias. Adaptación: `(snapshot_id, external_id)` único, FK de proyecto y coherencia del trabajo con su snapshot. Una FK no autoriza al usuario. |
| F7 | [NestJS: File upload and streaming](https://docs.nestjs.com/techniques/file-upload), Basic example, Default options, Memory usage and storage | Nest/Express soporta recepción multipart mediante Multer y opciones de almacenamiento. Adaptación: un archivo, límites de recepción y disco privado; no guardar todo el CSV en memoria. |
| F8 | [CSV Parse: Options](https://csv.js.org/parse/options/), `bom`, `cast`, `columns`, `delimiter`, `max_record_size`, `info` | Ofrece controles de interpretación, cabeceras y buffers. Adaptación: conservar cadenas, BOM explícito, política de cabeceras y límites. Candidato sin instalar ni versión fijada. No sustituye validación estricta UTF-8 o pruebas. |
| F12 | [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), 5.9 | Las políticas por fila requieren habilitación; propietarios y ciertos roles pueden omitirlas. Adaptación: mantener autorización por propietario en servicios/repositorios y no afirmar RLS existente. |
| F13 | [Multer: documentación del proveedor](https://github.com/expressjs/multer), File information, DiskStorage, MemoryStorage, limits y fileFilter | El body puede estar incompleto durante callbacks de almacenamiento. Sin storage/dest explícitos se retiene el archivo en memoria. `callback(null,false)` omite un archivo; no equivale a una excepción. Adaptar límites, orden de partes y limpieza explícita. |
| F14 | [Prisma ORM v7: Transactions and batch queries](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), Interactive transactions | `$transaction(async tx => ...)` delimita escrituras atómicas; usar el mismo tx y mantener el bloque corto. Adaptación: alta, reclamo, finalización y fallo en operaciones separadas; disco fuera de SQL. |
| F15 | [Nest: Request lifecycle](https://docs.nestjs.com/faq/request-lifecycle), Guards, Interceptors y Pipes | Guards preceden interceptores y pipes; un error de pipe puede observarse en el recorrido de retorno del interceptor. Adaptación: autorizar proyecto antes de recibir y envolver la limpieza para cubrir errores anteriores al controlador. |
| F16 | [Node: TextDecoder](https://nodejs.org/api/util.html#class-utiltextdecoder), constructor y decode | `fatal` convierte errores de decodificación en fallo; `stream` conserva secuencias entre chunks. Adaptar el parser UTF-8 estricto y verificar el final del stream. La página consultada es Node 26; la combinación efectiva debe comprobarse en Node 24 del proyecto. |

Los IDs se comparten con la [ficha de código e historial](01-estado-real-y-antecedentes.md). En `docs-diagrams/04`, E9–E14 son sus referencias globales equivalentes.

## Compatibilidad y límites

La API fija Prisma 7.10.0. La URL general de migraciones redirigió durante esta consulta a documentación de otra versión con flujo distinto; la referencia F4 se restringe expresamente a v7. Mantener los comandos y la historia SQL que usa el proyecto; no copiar instrucciones de una versión mayor.

Las páginas PostgreSQL `current` consultadas corresponden a versión 18; no se consultó el servidor remoto para determinar su versión. FK, transacciones y restricciones deberán probarse sobre el destino efectivo al implementar. Las referencias de Nest y CSV Parse son documentación web vigente, no una prueba de compatibilidad de paquetes todavía no instalados.

En la ampliación del Plan 03 se inspeccionó de nuevo el lockfile: Multer 2.4.0 aparece como dependencia transitiva de Nest/Express. F13 corresponde a la documentación del proveedor consultada, no a una reproducción certificada de esa versión. Antes de implementar, verificar opciones/tipos y errores contra el paquete resuelto; no copiar opciones nuevas de la rama principal. El curso describe una edición anterior y contiene una explicación de temporal por defecto que no se usa como garantía operativa: configurar almacenamiento explícito.

La decodificación UTF-8 y el límite del parser son independientes de `fileFilter` y del tamaño de carga. F8 documenta `max_record_size` en caracteres de buffers; el tope de 10 MiB es de bytes de archivo. El Plan 03 ahora distingue ambos. No se presenta un filtro MIME de imágenes como validación suficiente de CSV.

## Decisiones propias y comprobaciones pendientes

Los límites de 5.000 filas/10 MiB proceden de los requisitos del producto. El límite inicial de 200 columnas, la muestra de 20 registros, el delimitador explícito, la comparación exacta de IDs, un trabajador por proceso y marcar interrupciones como fallos son propuestas del plan, no recomendaciones textuales de las fuentes.

La revisión con [RC1–RC3](03-cursos-y-reconstrucciones-catalog-import.md) añade propuestas propias: campos multipart escalares únicos, envoltura de limpieza, claves internas sin sobrescritura, lotes acotados, coherencia de estados y comprobación de referencias ante un resultado de commit incierto. Esas decisiones no están enseñadas como un importador CSV por Fernando Herrera. El curso respalda mecanismos de carga y transacción; nuestra aplicación define las invariantes del catálogo.

Pendientes al implementar: seleccionar/fijar parser; validar tipos de multipart, buffers y streams; medir memoria/latencia; probar fallos de escritura/commit; verificar migración sobre datos heredados y acceso cruzado. Esta ficha acredita consulta documental y su interpretación, no ejecución de importaciones o cambios de base.
