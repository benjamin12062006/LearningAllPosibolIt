# 08 — Informe de la evaluación: BOM para Excel, descarga en Nest y medición

Fecha de creación: 2026-11-01  
Tipo de fuente: documentación oficial de Microsoft, tipos del paquete instalado y código de pruebas del proyecto.  
Origen:
- Microsoft Support (Excel);
- `@nestjs/common@12.0.3`;
- [catalog-import.repository.int-spec.ts](../../../../test/features/catalog-import/catalog-import.repository.int-spec.ts).

Fecha de consulta: 2026-11-01  
Relacionada con: [ficha 06 (formato de errores.csv)](06-csv-de-errores-owasp-y-rfc4180.md), [mapa para el plan, N10 y vacío de rendimiento](04-mapa-de-necesidades-para-el-plan.md), [plan 01, D10 y E4](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md), [bitácora 04](../../../../bitacora-construccion/feature/rulesets&evaluations/04-informe-de-la-evaluacion.md).

## Necesidad

E4 tenía tres preguntas sin fuente:
1. **BOM:** la ficha 06 dejó abierto si `errores.csv` debe llevar BOM UTF-8 para que Excel muestre bien los acentos.
2. **Descarga en Nest:** cómo devolver un archivo descargable sin tocar el objeto `response` de Express.
3. **Medición:** cómo medir la evaluación de 5.000 filas sin inventar un objetivo, porque el plan solo exige registrarla.

## Evidencia

| ID | Fuente y localizador | Evidencia | Aplicación |
| --- | --- | --- | --- |
| F36 | [Microsoft Support: Opening CSV UTF-8 files correctly in Excel](https://support.microsoft.com/en-us/excel/opening-csv-utf-8-files-correctly-in-excel), «Applies to: Excel», sin fecha de edición visible | «You can open a CSV file encoded with UTF-8 normally if it was saved with BOM (Byte Order Mark).» Sin BOM, la página propone importar con *Get Data → From Text/CSV* (Power Query) o con el asistente de texto. | `errores.csv` empieza con BOM (`U+FEFF`) para que el operador lo abra con doble clic. |
| F37 | Tipos instalados de `@nestjs/common@12.0.3`: `file-stream/streamable-file.d.ts` (constructores con `Uint8Array` o `Readable`) e `interfaces/streamable-options.interface.d.ts` | `StreamableFile` acepta `type` (cabecera `Content-Type`), `disposition` (`Content-Disposition`) y `length`. Enlaza a la guía [Streaming files](https://docs.nestjs.com/techniques/streaming-files). | El controlador devuelve `new StreamableFile(buffer, { type, disposition })`, sin usar `@Res()` ni el objeto `response` de Express. |
| F38 | [catalog-import.repository.int-spec.ts](../../../../test/features/catalog-import/catalog-import.repository.int-spec.ts), l. 435–439 | La prueba de 5.000 filas de la importación escribe una línea JSON (`benchmark`, `durationMs`, `rssBefore`, `rssAfter`) y solo afirma el resultado funcional, no un tiempo. | La medición de la evaluación sigue el mismo patrón: una línea `{"benchmark":"evaluation-5000",…}` sin umbral inventado. |

## Interpretación y límites

- F36 describe Excel. Otras hojas de cálculo y herramientas que no esperan BOM podrían mostrar un carácter extra al principio. Es el mismo criterio que con el tabulador de OWASP (ficha 06, F31): `errores.csv` es para leerlo una persona. El importador de esta API acepta BOM (catalog-import), así que el archivo se puede volver a leer.
- RFC 4180 (F32) no menciona el BOM. Añadirlo no cambia los registros ni el escape.
- F37 es el contrato de tipos de la versión instalada, no una prueba de comportamiento. La E2E comprueba las cabeceras reales.
- F38 mide en PGlite dentro del proceso de Jest. Los números orientan, pero no predicen Neon ni producción.
- No se abrió el archivo en Excel ni en Numbers. Esa comprobación manual sigue pendiente para el usuario.

## Aplicación en el proyecto

- D10 queda con BOM.
- La descarga usa `StreamableFile`.
- La medición se registra en la bitácora 04.
