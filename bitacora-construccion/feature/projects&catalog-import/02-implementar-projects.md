# 02 — Implementar proyectos desde espacios privados

Fecha de creación: 2026-10-25  
Estado: Implementado y verificado localmente; migración remota pendiente.  
Ámbito: Plan 02, API y migración PostgreSQL que renombra tabla y añade configuración.  
Relacionada con: [preparación](01-preparacion-y-alineacion.md), [plan](../../../docs/plans/feature/projects&catalog-import/02-plan-projects.md), [testing](../../settings/10-testing-nest-para-features.md), [antecedentes](../../../docs/fonts/feature/projects&catalog-import/01-estado-real-y-antecedentes.md).  
Revisión de partida: `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios ajenos previos conservados.

## Objetivo y decisiones

Reutilizar identidad, datos y aislamiento de espacios como proyectos, añadir configuración de tienda y operaciones por ID bajo propietario. El código vive en `src/projects`. Durante la ejecución el usuario pidió eliminar toda la compatibilidad antigua: se retiraron las carpetas anteriores, adaptadores, rutas, peticiones y tests específicos. El módulo actual registra únicamente ProjectsController/Service/Repository.

La migración nueva renombra la tabla a `estadistica_forms.projects`, sus restricciones e índice y añade configuración. Conserva filas e IDs; los tres SQL ya aplicados permanecen intactos para reproducir historia y actualizar bases existentes. Los códigos se validan con listas ISO de class-validator; no se infiere moneda desde país ni se afirma elegibilidad comercial para todos los países ISO. El perfil inicial es `google_merchant`. La protección después de un snapshot se integra con CatalogImportModule, pues todavía no existe esa tabla.

## Implementación y resultados observables

| Pieza | Cambio |
| --- | --- |
| [ProjectsModule](../../../src/projects/projects.module.ts), AppModule | Feature registrada y servicio exportado para importación. |
| [Controller](../../../src/projects/projects.controller.ts) y [DTOs](../../../src/projects/projects.dto.ts) | POST/GET `/api/v1/projects`, GET/PATCH por UUID; `{ project }` / `{ projects }`; sesión, trim, ISO, canal y campos extra. |
| [Service](../../../src/projects/projects.service.ts) | Perfil local, 404 ausente/ajeno, PATCH completo o nombre, rechazo de cuerpo vacío y `requireConfigured` con 409 contractual. |
| [Repository](../../../src/projects/projects.repository.ts) | SQL parametrizado, filtro de propietario en lectura/escritura, retorno y estado calculado. Creación exige configuración. |
| [Prisma](../../../prisma/schema.prisma), [migración](../../../prisma/migrations/20261025000100_configure_projects/migration.sql) | Project y relación AppUser.projects, tabla/índice/restricciones renombrados, configuración nullable solo para datos anteriores y CHECK de coherencia. |
| [Peticiones](../../../requests/projects.http), README y [fuentes](../../../docs/fonts/feature/projects&catalog-import/04-implementacion-projects.md) | Contrato, uso, continuidad y evidencia vigente. |

Las filas anteriores mantienen configuración nula y estado `required`; PATCH completa la terna y pasa a `ready`. No se asigna una configuración comercial inventada. Las rutas retiradas responden 404 y ya no existe un directorio runtime de espacios ni de compatibilidad.

## Verificación

Pruebas nuevas conforme al plan de testing: **46 aprobadas**, distribuidas en servicio (11), integración SQL (10) y HTTP (25). La [bitácora 10](../../settings/10-testing-nest-para-features.md) registra comandos, versiones, cobertura y el ensayo de fallos deliberados.

- Base vacía: Prisma aplica las cuatro migraciones; repetir deploy no las duplica.
- Base anterior con dos usuarios y espacios: la migración mantiene exactamente ID, propietario, nombre y fecha; la tabla final e índice se llaman projects y la tabla anterior deja de existir.
- Alice no lista, consulta ni modifica Bob. El acceso ajeno devuelve 404 y no cambia la fila.
- Nuevos POST requieren configuración; cuerpos ausentes/extra/nulos y valores inválidos dan 400 sin escritura. PATCH preserva la fila ante errores y completa configuración anterior.
- Sin Bearer o con token inválido: 401 sin escritura. Guard real; proveedor Descope controlado.
- Build y lint correctos; las 11 regresiones Node restantes pasan. Los tres SQL históricos se compararon byte a byte con HEAD sin cambios. Formato de los archivos afectados correcto; el check global conserva una advertencia previa en auth.module.ts.

## Aplicación y siguiente incremento

No se aplicó la migración a Cloud SQL. Antes de arrancar esta versión en ese destino, seguir el procedimiento existente: proxy y URL configurados, `pnpm db:status`, revisar `20261025000100_configure_projects`, `pnpm db:migrate` y nueva comprobación. Coordinar la migración con el despliegue porque cambia el nombre físico de la tabla. No usar reset ni editar las tres migraciones originales.

Sigue C1 del [Plan 03](../../../docs/plans/feature/projects&catalog-import/03-plan-catalog-import.md): archivo privado, snapshot/job y recepción autorizada. Al incorporar snapshots se implementará el bloqueo de configuración previsto. La UI de proyectos se aborda como incremento web independiente.
