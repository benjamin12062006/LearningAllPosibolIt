# 06 — Formato y seguridad de `errores.csv`

Fecha de creación: 2026-10-31  
Tipo de fuente: guía de seguridad de OWASP y especificación IETF.  
Origen: OWASP Community, «CSV Injection»; RFC 4180.  
Fecha de consulta: 2026-10-31  
Relacionada con: [mapa para el plan, N10](04-mapa-de-necesidades-para-el-plan.md), [plan 01, D10](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md), [alcance de la primera entrega](../../../../../docs-diagrams/01-producto-y-prototipo.md) (salida `errores.csv`).

## Necesidad

`errores.csv` [F5] contiene el ID externo de cada producto, que viene del catálogo del cliente sin modificar. El operador lo abrirá en una hoja de cálculo. Hay que decidir el formato del archivo y cómo evitar que un valor del catálogo se ejecute como fórmula. Ninguna ficha anterior lo cubría.

## Evidencia

| ID | Fuente y localizador | Evidencia | Aplicación posible |
| --- | --- | --- | --- |
| F31 | [OWASP Community: CSV Injection](https://community.owasp.org/attacks/CSV_Injection) (la URL `owasp.org/www-community/attacks/CSV_Injection` redirige con 308 a esta), sin fecha de edición visible; secciones de mitigación, «Important (Microsoft Excel behavior)», «Excel-resistant mitigation» y «Trade-off» | Ver la lista que sigue a esta tabla. | Elegir el escape de las celdas de `errores.csv` y aceptar su coste de forma explícita. |
| F32 | [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180), §2 reglas 1–7 y §3 | Registros separados por CRLF; cabecera opcional con el mismo número de campos; los campos con CRLF, comillas o comas «should be enclosed in double-quotes»; una comilla dentro de un campo se escapa duplicándola. Tipo `text/csv` con parámetros `charset` y `header` (`present` o `absent`). | Formato del archivo y cabecera `Content-Type`. |

**Contenido de F31:**

- **Caracteres de riesgo al inicio de una celda:** `=`, `+`, `-`, `@`, tabulador (`0x09`), retorno de carro (`0x0D`), salto de línea (`0x0A`) y sus variantes de ancho completo.
- **Mitigación general:** «Wrap each cell field in double quotes», «Prepend each cell field with a single quote» y «Escape every double quote using an additional double quote».
- **Advertencia sobre Excel:** puede quitar comillas o escapes al guardar y reabrir, y las fórmulas escapadas pueden volver a activarse.
- **Mitigación resistente en Excel:** prefijar con un tabulador, dentro del campo entre comillas, las celdas que empiezan por `=`, `+`, `-` o `@`. Coste: el tabulador queda en los datos y puede afectar a un procesamiento posterior. La página lo recomienda para archivos de lectura humana.
- La página dice que no hay una estrategia universal.

## Interpretación y límites

- `errores.csv` es un informe para lectura humana, no un formato de intercambio. Encaja en el caso para el que OWASP recomienda la mitigación resistente en Excel [F31].
- El tabulador cambia el valor visible del ID (por ejemplo, `-123` pasa a `\t-123`). Se acepta solo en este archivo. La API JSON y el futuro TSV del incremento 3 conservan el valor exacto, y el TSV necesitará su propia decisión.
- OWASP no da una lista cerrada de las variantes de ancho completo. Este plan usa los equivalentes de ancho completo de `=`, `+`, `-` y `@` (U+FF1D, U+FF0B, U+FF0D y U+FF20). Es una interpretación propia.
- Las celdas que ya empiezan por tabulador, CR o LF se prefijan igual, para que el primer carácter no lo interprete la hoja de cálculo. Tampoco esto lo detalla la fuente.
- Ninguna fuente consultada decide si añadir BOM UTF-8 para que Excel detecte la codificación. Queda como comprobación manual en E4: abrir el archivo en Excel o Numbers con acentos.
- No se probó en ninguna hoja de cálculo. F31 describe un comportamiento observado en Excel que «may differ in other spreadsheet applications».

## Aplicación en el proyecto

D10 del plan fija el formato y el escape. Ver el [plan](../../../plans/feature/rulesets&evaluations/01-plan-rulesets-y-evaluations.md).
