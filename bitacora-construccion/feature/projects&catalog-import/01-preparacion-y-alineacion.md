# 01 — Preparar projects y catalog-import sobre PostgreSQL

Fecha de creación: 2026-10-25  
Estado: Preparación documental completada; funcionalidades en estado Plan.  
Ámbito: actualización de diagramas, decisiones técnicas y ruta de construcción de la API.  
Relacionada con: [plan general](../../../docs/plans/feature/projects&catalog-import/01-plan-projects-y-catalog-import.md), [projects](../../../docs/plans/feature/projects&catalog-import/02-plan-projects.md), [catalog-import](../../../docs/plans/feature/projects&catalog-import/03-plan-catalog-import.md), [antecedentes](../../../docs/fonts/feature/projects&catalog-import/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../docs/fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md), [settings/09](../../settings/09-retirar-turso-tras-guardar-restauracion.md).  
Revisión de partida: API `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales previos de infraestructura, autenticación y documentación. Se conservan sin atribuirlos a esta preparación.

## Necesidad y punto de partida

El usuario pide alinear `docs-diagrams` con PostgreSQL y preparar un plan para reutilizar espacios como proyectos e iniciar importación CSV. Solicita la misma organización temática en bitácora, planes y fuentes. Se crea el subdirectorio literal `feature/projects&catalog-import/` dentro de cada área.

Los diagramas del 2026-10-12 describían Rust/Warp/SurrealDB y enlazaban código ausente. El árbol actual contiene API Nest/Express, Descope, Prisma/PostgreSQL y web Nuxt. La [entrada settings/07](../../settings/07-aplicar-migraciones-y-verificar-cloud-sql.md) ya registra aplicación remota de migraciones; no corresponde planificar otra sustitución de base. El módulo de espacios tiene creación/listado privados, pero no configuración de tienda ni importador.

## Evidencia, interpretación y decisión

La [ficha de antecedentes](../../../docs/fonts/feature/projects&catalog-import/01-estado-real-y-antecedentes.md) enlaza código y bitácoras. La [ficha técnica](../../../docs/fonts/feature/projects&catalog-import/02-fuentes-tecnicas.md) respalda los mecanismos propuestos con documentación oficial. No se atribuyen nuevas decisiones a cursos cuyos originales no se consultaron en esta preparación.

| Decisión | Resultado documental |
| --- | --- |
| Continuar con PostgreSQL, Prisma, Nest y Nuxt | Actualizar decisiones, arquitectura, persistencia, secuencias y contratos de los [diagramas](../../../../docs-diagrams/01-producto-y-prototipo.md). |
| Reutilizar identidad y espacios | Plan P0/P1: `projects`, propietario desde backend, conservación de IDs/FK y tabla física inicialmente. |
| No inventar configuración heredada | Estado derivado `required`; completar país, moneda y perfil antes de importar. |
| Separar importación de evaluación | Plan C1–C3: archivos privados, snapshots, trabajo básico, parser/lotes y muestra; reglas/exportación posteriores. |
| Garantizar aislamiento desde el inicio | Propiedad en proyectos y todos sus recursos; `404` para recurso ajeno. |
| Mantener la verdad del avance | Esta entrada documenta preparación; planes no equivalen a features implementadas. |

Se renombra el documento `06-dominio-y-datos-surrealdb.md` a [06-dominio-y-datos-postgresql.md](../../../../docs-diagrams/06-dominio-y-datos-postgresql.md), conservando su contenido de negocio y fecha original; sus enlaces internos se actualizan. El nombre anterior deja de existir como archivo independiente. El diseño técnico sustituido se identifica por fecha en los documentos vigentes.

## Comprobación de esta entrega

Se inspeccionaron código, dependencias, estado Git y entradas históricas; se consultaron las fuentes oficiales registradas. La validación de los nueve diagramas y seis documentos nuevos comprobó 136 enlaces locales sin destinos ausentes, fechas presentes y cierre de bloques Markdown. Se identificaron 13 bloques Mermaid; no se renderizaron en esta entrega. El inventario de las tres carpetas temáticas no detectó duplicados y deja como siguientes prefijos `02` en bitácora, `04` en planes y `03` en fuentes. La búsqueda de referencias al stack sustituido solo conserva menciones históricas explicativas. `git diff --check` sobre las áreas documentales nuevas de la API no mostró incidencias; sus archivos están sin seguimiento en Git, por lo que esa comprobación no sustituye la inspección directa de su contenido.

No se ejecutan compilación, pruebas de aplicación, importaciones, migraciones ni consultas remotas en esta entrega documental. Los resultados de pruebas PostgreSQL citados son históricos y se mantienen identificados como tales. No se cambian código, paquetes, datos o configuración privada.

## Continuidad

La primera implementación será P0/P1 de [projects](../../../docs/plans/feature/projects&catalog-import/02-plan-projects.md). Abrir la entrada temática `02` al comenzar ese incremento y completarla con símbolos, migración y comprobaciones reales. Después seguir [catalog-import](../../../docs/plans/feature/projects&catalog-import/03-plan-catalog-import.md), conservando una entrada por incremento coherente. La web se documentará en su propio componente cuando se implemente.
