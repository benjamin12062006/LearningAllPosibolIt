# 05 — Puntero a la versión publicada y enlace del archivo (E1)

Fecha de creación: 2026-11-02  
Estado: Fuentes consultadas para la etapa E1; se aplican en la [bitácora 01](../../../../bitacora-construccion/feature/feeds&publications/01-feed-y-publicacion-manual.md).  
Tipo de fuente: documentación oficial (PostgreSQL 18, páginas de manual de Linux).  
Fecha de consulta: 2026-11-02 (todas las URL de esta ficha)  
Revisión del proyecto: `f6b4bf9` con cambios sin commit.  
Relacionada con: [plan 01](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md) (D5, D6), [fuentes técnicas](02-fuentes-tecnicas.md) (F18), [cursos y reconstrucciones](03-cursos-y-reconstrucciones.md) (RC1).

## Necesidad

D5 deja dos preguntas para E1:

1. cómo garantizar en la base de datos que `feeds.published_version_id` apunta a una versión **del mismo feed**, y si hace falta una restricción diferible para insertar versión y puntero en una transacción;
2. qué garantiza `link` al enlazar el TSV de la exportación como archivo de la versión.

## Fuentes

| ID | Fuente y sección | Qué establece (paráfrasis) | Uso en E1 |
| --- | --- | --- | --- |
| F29 | [PostgreSQL 18: Constraints, §5.5.5 «Foreign Keys»](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK) | Una FK puede referenciar un grupo de columnas (forma de restricción de tabla), que deben ser clave primaria, restricción única o índice único no parcial. Por defecto, una fila con alguna columna referenciante nula no se comprueba. `CASCADE` borra las filas que referencian. `RESTRICT` impide borrar la fila referenciada y no se puede diferir; `NO ACTION` es la opción por defecto y su comprobación sí puede diferirse. Las columnas referenciantes no se indexan solas. | FK compuesta `feeds (id, published_version_id) → feed_versions (feed_id, id)`, con `UNIQUE (feed_id, id)` en `feed_versions`: el puntero solo admite una versión del propio feed, y mientras es nulo no se comprueba. No hace falta `DEFERRABLE`: la versión se inserta antes de mover el puntero, en la misma transacción. |
| F30 | [link(2), Linux man-pages](https://man7.org/linux/man-pages/man2/link.2.html) | `link` crea un segundo nombre para el mismo archivo; si el nombre nuevo existe falla con `EEXIST` sin sobrescribir; entre sistemas de archivos distintos falla con `EXDEV`. La página no dice qué pasa con el contenido al borrar uno de los nombres. | `feeds/<versionId>.tsv` como segundo nombre del TSV de la exportación, sin copiar bytes. `exports/` y `feeds/` están bajo la misma raíz, así que no habrá `EXDEV`. Que borrar `exports/<clave>.tsv` no borre el contenido de la versión **se comprueba con una prueba de integración**, en lugar de suponerlo. |

## Límites

- PGlite comprueba las FK como PostgreSQL, pero es de una sola conexión: no demuestra esperas entre transacciones (R4 del plan).
- En macOS (desarrollo) y Linux (despliegue) `link` funciona igual para archivos normales; no se consultó la documentación de macOS.
