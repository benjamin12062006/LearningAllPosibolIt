# 08 — Hora local y zona horaria de la programación (E6)

Fecha de creación: 2026-11-03  
Estado: Fuentes consultadas para la etapa E6; se aplican en la [bitácora 06](../../../../bitacora-construccion/feature/feeds&publications/06-programacion-diaria.md).  
Tipo de fuente: documentación de referencia (MDN) y comprobación local.  
Fecha de consulta: 2026-11-03  
Revisión del proyecto: `f6b4bf9` con los cambios sin commit de E1–E5.  
Relacionada con: [plan 01](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md) (D10), [fuentes técnicas](02-fuentes-tecnicas.md) (F15).

## Necesidad

D10 programa la actualización diaria por hora local y zona horaria del proyecto, sin librerías nuevas: hay que saber qué fecha y qué hora son «ahora» en una zona IANA y cómo rechazar una zona inválida.

## Fuentes

| ID | Fuente y sección | Qué establece (paráfrasis) | Uso en E6 |
| --- | --- | --- | --- |
| F36 | [MDN: `Intl.DateTimeFormat()` constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat), opciones `timeZone` y `hourCycle`, y «Exceptions» | `timeZone` admite cualquier nombre IANA (`UTC`, `America/New_York`, `Etc/GMT+8`) e identificadores de desplazamiento (`+01:00`). Por defecto usa la zona del proceso. Opciones inválidas lanzan `RangeError`. `hourCycle: 'h23'` da horas de 00 a 23. | `isRefreshDue` formatea el instante en la zona del feed con `formatToParts` y `hourCycle: 'h23'`, y compara `HH:MM` con la hora programada. La zona se valida intentando construir un `Intl.DateTimeFormat`: si lanza `RangeError`, no es válida. Nunca se usa la zona del proceso. |

## Decisiones que se apoyan en la fuente y en el plan

- **Fecha local como clave del día:** `UNIQUE (feed_id, scheduled_for)` con la fecha local `AAAA-MM-DD`. Varias instancias (o varios ticks) intentan insertar; solo una lo consigue (F15: el programador dispara en cada proceso).
- **Cambios de hora (DST):** si la hora programada no existe ese día (adelanto del reloj), la primera hora local posterior ya la supera y la actualización se dispara. Si la hora se repite (retraso), la clave de la fecha local impide una segunda actualización. Se comprueba con pruebas en `Europe/Madrid` el 2026-03-29 y el 2026-10-25.

## Límites

- `formatToParts` tiene su propia página en MDN, que no se leyó; su comportamiento se comprueba con las pruebas unitarias.
- Se admiten también los identificadores de desplazamiento (`+01:00`), que no cambian con el horario de verano: es una elección del operador.
