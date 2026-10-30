# 05 — Evidencia aplicada a CatalogImportModule

Fecha de creación: 2026-10-26  
Tipo de fuente: transcripciones y guías reutilizadas, documentación oficial, código y pruebas del proyecto.  
Fecha de consulta: 2026-10-26  
Relacionada con: [Plan 03](../../../plans/feature/projects&catalog-import/03-plan-catalog-import.md), [reconstrucciones RC1–RC3](03-cursos-y-reconstrucciones-catalog-import.md), [bitácora 03](../../../../bitacora-construccion/feature/projects&catalog-import/03-implementar-catalog-import.md).

## Cadena de procedencia y adaptación

| Necesidad | Evidencia consultada | Adaptación y archivo | Verificación correspondiente |
| --- | --- | --- | --- |
| Archivo obligatorio y recepción multipart | Original 155, líneas 19–29/35–41; RC1 fases 1–3, E1–E10. Originales y guías enlazados en ficha 03. | [ImportUploadInterceptor](../../../../src/catalog-import/import-upload.interceptor.ts) recibe con Multer, verifica archivo/campos y limpia temporales incluso si un pipe falla. Guard de acceso precede la carga. | HTTP real: ausencia, segundo archivo, campos duplicados/desconocidos/anidados, DTO, orden de partes y multipart truncado. |
| Identidad del archivo independiente del cliente | Original 157, líneas 15–29/33; RC2 fases 1–3, E1–E9. | [ArtifactStore](../../../../src/catalog-import/artifact.store.ts): UUID nativo, permisos privados, escritura exclusiva, SHA-256 y enlace final sin sobrescritura. Se usa un storage engine propio para acotar escritura y sincronizar el archivo. | Disco real: colisión forzada, permisos, tamaño exacto/superior y aborto. La guía no acredita estas garantías por sí sola. |
| Escrituras atómicas y rollback | Original 145, líneas 15–35/39–45; RC3 fases 1–3, E1–E10. | [Repositorio](../../../../src/catalog-import/catalog-import.repository.ts): transacciones Prisma cortas, mismo tx para snapshot/job, lotes y finalización. Disco fuera del bloque SQL. | PostgreSQL temporal: fallo de segunda escritura del alta/finalización, unicidad, FK compuesta y progreso de lote revertido. |
| Interpretación de CSV sin coerción | [CSV Parse options](https://csv.js.org/parse/options/), bom/cast/columns/relax_column_count/max_record_size; paquete instalado 7.0.3. | [Parser](../../../../src/catalog-import/csv-parser.ts): arrays, cabeceras verificadas, anchura validada por fila, strings originales, UTF-8 fatal, límites y IDs exactos. | Fixtures de BOM, multibyte, comillas/saltos, errores de estructura, valores especiales, 5.000/5.001 filas y registro anormal. |
| Límites y limpieza de multipart | [Nest File upload](https://docs.nestjs.com/techniques/file-upload) y [Multer](https://github.com/expressjs/multer), storage engines/limits; código local de Multer 2.4.0. | Límites explícitos y rechazo de campos anidados; destino independiente del body incompleto. API de Multer utilizada directamente dentro del interceptor inyectable para controlar storage y limpieza. | HTTP con partes en ambos órdenes, truncado y límite inclusivo de 10 MiB. No se traslada el filtro MIME de imágenes del curso. |
| Transacción Prisma actual | [Prisma v7 transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), interactive transactions. | `$transaction(async tx => …)` con bloqueo de proyecto compartido por aceptación y PATCH; configuración copiada al snapshot. | Carrera PATCH/aceptación en integración, configuración bloqueada tras aceptar y renombrado permitido. |

Se reutilizaron las guías existentes; no se generó ni instaló otra reconstrucción. `reconstruction.py verify` sobre el manifiesto anterior confirmó **3 guías, 6 originales y 0 escrituras**. El helper valida procedencia; las comprobaciones de la aplicación se registran separadamente en la bitácora.

## Decisiones propias y límites

Parser, estados, jobs, privacidad por propietario, compensación y recuperación son diseño del producto. El curso muestra imágenes y TypeORM. Se preserva esa diferencia y no se afirma que el instructor haya implementado el importador CSV.

La combinación efectiva incluye Node 24.22.1, Nest 12.0.3, Prisma 7.10.0, csv-parse 7.0.3, Multer 2.4.0 y tipos Multer 2.3.0. Jest/Nest/Supertest siguen la base ya implementada. No se instaló TypeORM ni una cola genérica.

En csv-parse 7.0.3 se verificó que `max_record_size: 1_048_576` rechaza un campo de 600.000 caracteres `é` y admite 600.000 ASCII. Aunque la documentación habla de caracteres de buffer, la ejecución con entrada UTF-8 muestra consumo en bytes del buffer para este caso. El producto conserva el tope separado de 10 MiB por archivo; no promete un millón de caracteres Unicode por registro.

El worker espera cada lote y solo habilita muestras con ready. El cierre usa `onModuleDestroy` en CatalogImportModule antes de cerrar el PrismaService importado; el orden se comprobó al cerrar la app real de pruebas. El arranque marca running heredados como interrumpidos y conserva queued para procesarlos. Este procedimiento requiere una sola instancia y un volumen privado persistente.

No se estableció una política de borrado automático de artefactos. Ante commit incierto y base inaccesible, se conserva el final y se registra la correlación. La conciliación de archivos sin referencia requiere comprobación operativa antes de retirarlos. No existe garantía de idempotencia entre POST distintos ni soporte para varias réplicas.

Las mediciones locales usan PGlite/WASM, fixtures e instrumentación de cobertura; no constituyen una prueba de carga de PostgreSQL remoto. No se aplicaron migraciones a Cloud SQL ni se ejecutó login externo. El plan global de mensajes bilingües sigue pendiente; los errores actuales del importador usan código, mensaje en español y requestId.
