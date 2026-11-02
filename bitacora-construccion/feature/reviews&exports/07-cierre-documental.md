# 07 — Cierre documental del incremento 3 (E7)

Fecha de creación: 2026-11-02  
Estado: Implementado y verificado (documentación). Sin cambios de código.  
Ámbito: etapa E7 del [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md): actualizar `docs-diagrams/06` (datos) y `07` (módulos y contrato) con lo implementado, anotar el incremento 3 en `09` y cerrar el plan.  
Relacionada con: [plan 01](../../../docs/plans/feature/reviews&exports/01-plan-reviews-y-exports.md), bitácoras [01](01-serializador-tsv.md), [02](02-comprobar-la-aprobacion.md), [03](03-perfil-de-google-v2026-11-01.md), [04](04-modulo-de-artefactos.md), [05](05-exportar.md) y [06](06-descarga-borrados-y-limpieza.md); diagramas [06](../../../../docs-diagrams/06-dominio-y-datos-postgresql.md), [07](../../../../docs-diagrams/07-arquitectura-y-contratos.md) y [09](../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md).  
Revisión de partida: `d5e8f54` con los cambios sin commit de E1–E6.

## Necesidad y punto de partida

El usuario pidió empezar E7. Tras E6: 31 suites y 585 pruebas en verde.

Al releer `docs-diagrams` aparecieron los documentos 10–19, creados el 2026-11-01 después de la Fase 0 de esta feature. Son un plan posterior (ampliación SaaS) y no se tocan aquí:

- el 18 exige terminar antes `reviews&exports` («E0 no sirve para saltar reviews/exports»);
- el 11 describe la API cuando estaban hechas E1–E4, así que esa descripción ya no está al día;
- su línea sobre `ArtifactStore` (evitar que la limpieza de importaciones borre otros tipos de archivo) coincide con el diseño de E4: claves y limpieza por carpeta.

## Cambios en los diagramas

Todos son añadidos o notas fechadas. No se borra lo previsto para la fase B.

| Documento | Cambio |
| --- | --- |
| [06 — Dominio y datos](../../../../docs-diagrams/06-dominio-y-datos-postgresql.md) | `Última actualización` con enlace al plan. Clase `Export` y relación «exporta en A» con `Evaluation`. Párrafo que separa `Export` (fase A) de `FeedVersion` (fase B). Relación `EVALUATION ||--o| EXPORT` en el diagrama ER. Fila `exports` en el diccionario y «Fase B» en `feed`/`feed_version`. Invariante 5 aplicada a la exportación. Carpetas `artifacts/` y `exports/`, y retirada de TSV en los borrados. |
| [07 — Arquitectura y contratos](../../../../docs-diagrams/07-arquitectura-y-contratos.md) | `Última actualización` con enlace al plan. `ExportsModule` y `ArtifactsModule` en el diagrama de dependencias. Nota fechada que corrige «estas carpetas todavía no existen en código». Filas del contrato «Exportar, A», «Consultar exportación, A» y «Descargar exportación, A». |
| [09 — Decisiones y construcción](../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md) | `Última actualización` y estado del incremento 3: API implementada y verificada en local; faltan aplicar la migración en Neon y procesar el TSV en la cuenta piloto. |

Se guardaron copias de los tres documentos antes de editarlos y se contaron las líneas cambiadas con `diff`: 18 líneas de `diff` en 06, 14 en 07 y 4 en 09.

## Comprobación

| Comprobación ejecutada | Resultado |
| --- | --- |
| Enlaces locales de los diagramas editados, el plan y esta bitácora (script de Python que resuelve cada ruta) | 58 enlaces, ninguno roto: plan 21, esta bitácora 14, diagrama 06 8, diagrama 07 4, diagrama 09 11. |
| Caracteres invisibles en los mismos archivos | Ninguno. |
| Pruebas | No se volvieron a ejecutar: E7 no cambia código. La última ejecución (E6) dio 31 suites y 585 pruebas en verde. |

**No verificado:** los diagramas Mermaid editados no se renderizaron. No hay una herramienta de Mermaid instalada en el proyecto, y descargarla no estaba en el alcance. Las líneas nuevas copian la sintaxis de las existentes en el mismo diagrama (`A "0..1" --> "1" B : texto`, `A ||--o| B : texto`, nodos de `flowchart`).

## Consecuencias y continuidad

- **Plan cerrado en local:** E1–E7 hechas.
- **Pendientes del usuario:**
  - aplicar la migración `20261101000300_create_exports` en Neon, primero con `pnpm db:status` y después con `pnpm db:migrate`;
  - repetir las evaluaciones guardadas (cambiaron el motor y el perfil en E3);
  - procesar un TSV en la cuenta piloto de Merchant Center (D14);
  - decidir los commits.
- **Siguiente trabajo según los diagramas:** la interfaz Nuxt (1c), GraphQL de evaluaciones y exportaciones (plan `02` de la feature anterior) y, después, la ampliación de los documentos 10–19.
