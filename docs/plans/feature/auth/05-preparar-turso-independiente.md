# 05 — Conservar Turso preparado para el futuro

Fecha de creación: 2026-10-22
Última actualización: 2026-10-22
Estado: Preparación implementada y verificada localmente
Ámbito: segunda integración de persistencia preparada, sin consumidores actuales
Relacionada con: [plan PostgreSQL](04-sustituir-turso-por-cloud-sql-postgresql.md), [registro del cambio](../../../../bitacora-construccion/settings/08-preparar-turso-independiente.md), [retirada posterior](../../../../bitacora-construccion/settings/09-retirar-turso-tras-guardar-restauracion.md).

Aviso histórico: el plan se implementó y posteriormente se retiró por petición del usuario. Su código y guía se recuperan del commit local `a551ed8`; las instrucciones siguientes no describen el estado actual.

## Objetivo

Conservar TypeScript, Prisma/libSQL, variables y migraciones Turso de forma independiente. PostgreSQL continúa atendiendo las funcionalidades existentes. El arranque de la API no exige credenciales Turso ni abre su conexión.

## Incrementos

1. Recuperar desde `01a16a4` el schema SQLite y el migrador versionado. Darles rutas exclusivas: `prisma/turso/schema.prisma`, `prisma/migrations-turso/` y `scripts/db/migration-turso.mjs`.
2. Restaurar las dependencias fijadas y generar un cliente Prisma diferente. Preparar un módulo Nest opcional con conexión explícita y cierre de recursos; no importarlo en `AppModule`, usuarios, espacios o `PrismaModule` PostgreSQL.
3. Restaurar `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` en los ejemplos y en el entorno privado. Las credenciales borradas no se recuperan de Git; conservar valores que el usuario haya repuesto y dejar vacíos los que falten.
4. Verificar con libSQL local y con las pruebas PostgreSQL existentes. Documentar comandos separados de generación, estado y aplicación, y el paso explícito que requeriría una futura feature para consumir Turso.

## Criterio de cierre

Ambos clientes compilan; las migraciones de un motor no usan la carpeta del otro; las pruebas Turso son repetibles; construir el servicio opcional no conecta ni valida credenciales. Ninguna función actual cambia de base ni se ejecutan escrituras remotas durante esta preparación.

## Cierre

Los cuatro incrementos se completaron. Se generaron y validaron ambos clientes, Nest compila, lint y formato son correctos, y las 20 pruebas locales aprobaron. La [entrada 08](../../../../bitacora-construccion/settings/08-preparar-turso-independiente.md) conserva los archivos y comprobaciones ejecutadas. Turso queda deliberadamente inactivo: sus dos variables privadas están presentes y vacías, sin credenciales recuperables en Git. No se consultó ni modificó Turso remoto; una futura feature deberá elegir explícitamente su uso.
