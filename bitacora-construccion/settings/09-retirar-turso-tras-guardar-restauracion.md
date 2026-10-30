# 09 — Retirar Turso después de guardar un punto de restauración

Fecha de creación: 2026-10-22
Estado: Implementado y verificado
Ámbito: backend Nest, configuración, Prisma, dependencias y pruebas
Relacionada con: [preparación anterior](08-preparar-turso-independiente.md), [PostgreSQL activo](07-aplicar-migraciones-y-verificar-cloud-sql.md).
Revisión de partida y restauración: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, rama local `main`.

## Necesidad y evidencia

El usuario cambia la decisión anterior: primero guardar el estado completo del backend y después retirar Turso, incluso su preparación para el futuro. El commit de partida conserva la implementación independiente, sus migraciones y guía. Se creó y verificó antes de comenzar la retirada; no se publicó ni incluyó `.env` o credenciales.

La inspección de `PrismaModule`, `PrismaService` y los repositorios confirma que las funcionalidades actuales usan PostgreSQL. La retirada elimina una segunda integración sin consumidores; no requiere cambiar contratos HTTP ni migraciones PostgreSQL aplicadas. Es una decisión del proyecto basada en su código e historial, no atribuida a un curso.

## Alcance

Retirar servicio/módulo/conexión Turso, schema y configuración Prisma secundarios, cliente generado, migrador, migraciones SQLite operativas y archivadas, pruebas exclusivas, scripts y dependencias libSQL, variables Turso del entorno privado y ejemplo, y guía operativa. Mantener el historial documental con aviso de retirada y referencia al commit recuperable.

No borrar bases remotas ni sus datos. No modificar el SQL PostgreSQL ya aplicado: sus checksums deben conservarse. El commit respalda archivos versionados, no secretos ni datos de bases.

## Implementación

Se retiraron los elementos enumerados, incluidas las copias de migraciones `prisma/migrations-turso` y `prisma/sqlite-legacy`, el schema secundario, sus diez archivos generados y la guía operativa. `pnpm remove` eliminó las dos dependencias directas y 22 paquetes de la instalación; el lockfile ya no contiene referencias libSQL/Turso. La compilación limpia de Nest también retiró los artefactos secundarios de `dist`.

`prisma:generate` vuelve a generar únicamente el cliente PostgreSQL. El test de configuración conserva su comprobación de rechazo de una URL genérica, sin usar una URL del proveedor retirado. Las variables privadas se eliminaron sin imprimir sus valores ni alterar el resto del entorno. README y las entradas históricas ahora distinguen la retirada del estado previo, sin borrar la trazabilidad.

## Verificación ejecutada

- Generación del cliente y validación del schema PostgreSQL: correctas.
- Compilación Nest y lint con tipos: correctos.
- `node --test --test-concurrency=1 test/*.test.mjs`: **15/15 aprobadas**, ninguna omitida. Verifican migraciones PostgreSQL repetibles, rutas protegidas, perfiles y aislamiento de espacios. Se retiraron las cinco pruebas exclusivas del proveedor eliminado.
- Prettier sobre el test modificado y `package.json`: correcto.
- La búsqueda de Turso/libSQL en código de conexión, repositorios, tests, scripts, entorno de ejemplo, package, lockfile y configuración no devuelve referencias operativas.
- Comparación byte por byte con `a551ed8`: las tres migraciones PostgreSQL y su lock permanecen idénticos; no quedan carpetas secundarias ni artefactos Turso en `src` o `dist`.
- `node scripts/db/check-postgres.mjs`, con acceso de red autorizado: lectura correcta en `expo-city-bol-database` con `catalogo_api`, `ok: 1` y `usersTableExists: true`.
- `git diff --check`: correcto.

Las pruebas usan PostgreSQL temporal, sin escrituras remotas. El SQL PostgreSQL aplicado no se modificó. Las únicas referencias restantes al proveedor retirado pertenecen al historial documental y a comentarios históricos de migraciones inmutables.

## Recuperación

El punto de restauración es el commit local `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35` en `main`, creado antes de la retirada y sin publicar. Para consultar un archivo anterior sin cambiar el árbol: `git show a551ed8:ruta/del/archivo`. Los clientes generados se pueden regenerar a partir del schema de ese commit. No se creó una nueva release ni se modificaron tags. `.env`, credenciales y datos remotos no forman parte del commit.
