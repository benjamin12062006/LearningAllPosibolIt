# 03 — Importar CSV privados y conservar snapshots

Fecha de creación: 2026-10-26  
Estado: Implementado y verificado localmente. Migración remota y volumen de despliegue pendientes.  
Ámbito: C1–C3 del Plan 03, API, persistencia, almacenamiento y pruebas locales.  
Relacionada con: [Projects](02-implementar-projects.md), [Plan 03](../../../docs/plans/feature/projects&catalog-import/03-plan-catalog-import.md), [fuentes y reconstrucciones](../../../docs/fonts/feature/projects&catalog-import/03-cursos-y-reconstrucciones-catalog-import.md), [testing](../../settings/10-testing-nest-para-features.md).  
Revisión de partida: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales previos conservados.

## Objetivo y decisiones iniciales

Recibir un CSV en un proyecto propio/configurado, aceptar archivo y trabajo persistidos y procesar por lotes. Una muestra solo se publica cuando snapshot y trabajo terminan juntos. El proceso inicial es de una instancia y un trabajo activo.

Se reutilizan RC1/RC2/RC3: archivo obligatorio, nombre propio y transacciones con un mismo contexto. La adaptación usa almacenamiento privado, UUID nativo y Prisma, sin copiar el storage público ni TypeORM del curso. Parser, compensación, estados y autorización son decisiones propias del Plan 03. El plan bilingüe permanece pendiente; este incremento mantiene mensajes públicos con códigos estables y requestId.

## Evidencia aplicada y archivos

La [fuente 05](../../../docs/fonts/feature/projects&catalog-import/05-implementacion-catalog-import.md) registra necesidad → original/localizador → guía/fase → adaptación → archivo → prueba. RC1 es la clase 155, RC2 la 157 y RC3 la 145. El helper de reconstrucción volvió a verificar 3 guías y 6 originales con cero escrituras; no se generaron otras guías ni se ejecutó el proyecto del curso.

| Pieza | Resultado |
| --- | --- |
| [Controller](../../../src/catalog-import/catalog-import.controller.ts), [guard](../../../src/catalog-import/import-access.guard.ts), [interceptor](../../../src/catalog-import/import-upload.interceptor.ts) y DTO | POST multipart autorizado antes de recibir, límites de transporte y limpieza incluso si falla un pipe o llega multipart truncado. GET de estado y muestra con padre/propietario verificados. |
| [ArtifactStore](../../../src/catalog-import/artifact.store.ts) | Temporal/final privados, clave propia, escritura exclusiva, hash y fsync de archivo/directorio. Link exclusivo para no sobrescribir. Aborto y rechazo retiran el temporal. |
| [Service](../../../src/catalog-import/catalog-import.service.ts) | Aceptación confirmada antes de 202; recuperación por IDs y clave si se pierde la respuesta del commit. Ausencia confirmada compensa el final; resultado incierto conserva archivo y registra correlación. |
| [Repositorio](../../../src/catalog-import/catalog-import.repository.ts) y [migración](../../../prisma/migrations/20261026000100_create_catalog_import/migration.sql) | Snapshot/job atómicos, reclamo condicional, lotes y finalización con el mismo tx. FK compuesta, IDs únicos por snapshot y estados restringidos. Se reutiliza PrismaService. |
| [Parser](../../../src/catalog-import/csv-parser.ts) | UTF-8 fatal, strings originales, cabeceras/anchura/IDs exactos, comillas y registros lógicos. Límite de archivo y de registro independientes. |
| [Worker](../../../src/catalog-import/catalog-import.worker.ts) | Una importación activa, lotes esperados de 250 filas/1 MiB serializado, fila excepcional sola, comprobación de hash/bytes/conteo y publicación atómica. |
| [ProjectsRepository](../../../src/projects/projects.repository.ts) | Mismo bloqueo de fila que aceptación; conserva configuración usada por el snapshot y rechaza cambios posteriores con 409. Renombrar sigue permitido. |
| [Filtro](../../../src/catalog-import/import-exception.filter.ts) | Errores públicos con código/mensaje/requestId, sin exponer rutas, SQL o credenciales. Acotado a la feature, sin ejecutar el plan bilingüe global. |

Se añadió `CATALOG_IMPORT_ROOT` a `.env.example`; `.data/` ya estaba excluido de Git. El catálogo no se sirve como estático. Los detalles de ejecución manual están en [requests/catalog-import.http](../../../requests/catalog-import.http) y README.

## Iteraciones que cambiaron la implementación

La primera prueba de disco detectó que un WriteStream con `autoClose: false` impedía terminar el cierre esperado. Se reemplazó por un Writable que espera las escrituras del FileHandle y lo sincroniza/cierra explícitamente. Los tests de aborto y tamaño ahora cierran sin advertencias de descriptores abiertos.

La validación inicial del ancho del parser podía adelantarse a la comprobación de cabeceras y producir un error genérico. Se permitió recibir arrays de distinto ancho para comprobarlo explícitamente en el orden correcto. Esto conserva el rechazo de filas desiguales con ordinal lógico.

El límite `max_record_size: 1_048_576` del csv-parse instalado rechazó 600.000 caracteres multibyte `é` y admitió 600.000 ASCII. Se documenta el comportamiento efectivo del buffer UTF-8, sin equipararlo al número de caracteres Unicode ni al límite de bytes del archivo.

Se comprobó el orden de destrucción de Nest: el worker cierra mediante `onModuleDestroy` antes del PrismaService importado. Usar únicamente `beforeApplicationShutdown` habría dejado ese trabajo después del cierre de base. El test de cierre aborta un stream activo al vencer el plazo; HTTP verifica el orden real al cerrar la app.

El timeout de Jest se colocó en la configuración raíz, donde es efectivo para las suites, en lugar de dentro de cada proyecto Jest. El test de cierre se adaptó a las librerías ES2023 del proyecto sin cambiar el target por usar una API nueva de Promise.

## Comprobaciones realizadas

Combinación: Node 24.22.1, pnpm 12.5.1, Nest/testing 12.0.3, TypeScript 6.0.3, Prisma 7.10.0, csv-parse 7.0.3, Multer 2.4.0, tipos Multer 2.3.0, Jest 30.5.2 y Supertest 7.3.1. Dependencias directas fijadas y lockfile actualizado. pnpm detectó un build opcional de esbuild por la dependencia tsx ya existente; se deshabilitó el script y se confirmó instalación frozen correcta con binario precompilado.

| Comando/comprobación | Resultado |
| --- | --- |
| `pnpm test:features:cov` | **108 casos en 9 suites aprobados**: 42 unitarios, 22 integración y 44 HTTP. Incluye 62 casos nuevos de CatalogImport y 46 de Projects. |
| Cobertura V8 | CatalogImport: 96,26 % líneas/sentencias y 90,07 % ramas; conjunto de features: 96,68 % líneas. Se usa como diagnóstico, no como garantía. |
| Casos aislados y grupos durante construcción | Parser/almacenamiento/servicio, SQL y multipart ejecutados por separado. Multipart truncado se comprobó además con filtro de nombre. |
| Ensayo de detección de fallos | Expectativas falsas sobre `000123`, conteo 25 y HTTP 202 produjeron 3 fallos, exit 1. Se restauraron y se repitió el conjunto completo en verde. |
| Build, lint y formato afectado | Correctos; el build productivo no contiene archivos de test. |
| Instalación frozen | Correcta, sin resolver nuevas versiones. |
| Historia SQL | Cuatro migraciones previas comparadas byte a byte con el índice de partida, intactas. La nueva es la quinta. |
| `node --test test/*.test.mjs` tras build | 11 regresiones Node aprobadas, incluida migración desde cero y deploy repetido. |
| Enlaces locales de README y documentos vigentes revisados | 117 destinos, ninguno ausente. |
| Compatibilidad de tsx/esbuild existente | Evaluación TypeScript mínima correcta, sin habilitar el script opcional de instalación. El CLI requirió permiso para su IPC local. |

La prueba de migraciones y las regresiones Node se ejecutaron sobre bases temporales nuevas, igual que las suites de feature. No se leyeron credenciales ni se realizaron escrituras remotas durante estas verificaciones.

La matriz cubre autorización antes del disco; ambos órdenes de partes; campos y archivos ausentes/repetidos/extra; límite inclusivo de 10 MiB; UTF-8/BOM/comillas/saltos; 5.000/5.001 filas; columnas/cabeceras; ceros y valores especiales; colisión forzada; rollback de alta, lote y finalización; muestras bloqueadas ante fallo; FK entre proyecto y snapshot; carrera de configuración; commit perdido/incierto y fallo de respuesta después de commit. La identidad externa se controla, el guard permanece real.

Running heredados se marcan failed/IMPORT_INTERRUPTED y queued persiste para retomarse. Archivo ausente y hash incorrecto fallan con códigos estables. Un fallo después de 250 filas confirmadas conserva esas filas privadas y devuelve muestra vacía; un fallo en la segunda escritura de finalización revierte ready antes de marcar ambos recursos failed.

## Medición local

Con cobertura activada, PGlite/WASM y fixtures dentro del proceso de tests:

| Escenario | Observación registrada durante el cierre |
| --- | --- |
| CSV de 5.000 filas y 10.040.009 bytes | Procesamiento: 5.977 ms. Trabajo succeeded, conteo 5.000 y valores originales persistidos. |
| RSS del proceso completo antes/después | 1.101.185.024 / 1.139.015.680 bytes. Incluye otras suites, fixtures, motor WASM y cobertura; no mide el pico ni el consumo exclusivo del worker. |
| Consulta HTTP durante CSV de 5.000 filas y 10.028.899 bytes | 177 ms para leer estado; procesamiento y consulta terminan correctamente. |

Son observaciones de este equipo, sin SLA ni garantía para Cloud SQL. Antes del piloto medir memoria pico, latencia y persistencia en el volumen/runtime reales, sin extrapolar el RSS de la suite a producción.

## Operación y continuación

No se aplicaron migraciones a Cloud SQL. Antes del despliegue coordinar las migraciones pendientes de Projects y CatalogImport con la API: procedimiento existente de proxy/URL, `db:status`, revisión SQL y `db:migrate`, sin reset. Preparar un volumen privado persistente y validar su durabilidad.

La recuperación inicial presupone **una sola instancia API/worker**. Leases, fencing, recuperación concurrente y varias réplicas quedan para la evolución B. No hay borrado automático por retención. Ante commit incierto y base inaccesible, conservar el final y comprobar referencias por IDs/clave antes de una limpieza manual; no retirar archivos mientras hay cargas activas.

Sigue U1: integrar en Nuxt selección de proyecto, carga y consulta de resultado. El plan de mensajes bilingües permanece pendiente de orden independiente; evaluación, mapeo, reglas, feeds, IA y descargas del original no se implementaron aquí.
