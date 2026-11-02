# 03 — Cursos y reconstrucciones para reviews y exports

Fecha de creación: 2026-11-01  
Estado: Seis guías reconstruidas, renderizadas, verificadas e instaladas; plan sin escribir; feature no implementada.  
Tipo de fuente: transcripciones originales, guías derivadas y registro de herramientas.  
Origen: Fernando Herrera/DevTalles (`NestJS Backend Completo`, `Reportes PDF con NestJS`, `Microservicios con NestJS`, `Testing en NestJS`); `SQL Completo` (el instructor no consta en los metadatos).  
Fecha de consulta: 2026-11-01  
Revisión del proyecto: `d5e8f54`.  
Relacionada con: [estado real](01-estado-real-y-antecedentes.md), [fuentes técnicas](02-fuentes-tecnicas.md), [mapa para el plan](04-mapa-de-necesidades-para-el-plan.md), [recetas](reconstrucciones/recetas/), [salida verificada](reconstrucciones/salida-2026-11-01/).

Biblioteca: `/Users/benji/Documents/chrome-extencions/trancripciones/`. Las rutas de las tablas son relativas a esa raíz.

## Necesidad y selección

La feature necesita: (1) generar un archivo en el servidor y entregarlo como descarga privada; (2) que el cliente nombre el recurso sin elegir rutas del disco; (3) compartir el almacenamiento de archivos entre módulos; (4) grabar la exportación y sus exclusiones juntas, sin confiar en datos que envía el cliente; (5) probar descargas y archivos en disco limpiando lo que se crea.

Se buscó con `search_transcripts.py` (resultados por sección, poco precisos) y después con `rg` sobre la biblioteca: `sendFile`, `StreamableFile`, `Content-Disposition`, `setHeader(`, `createReadStream`, `$transaction`, `ROLLBACK`, `transacción`, `checksum`, `sha256`, `inmutab`, `tsv`, `tab-separated`. Se leyeron completos con `nl -ba` los originales seleccionados y el contexto previo mínimo. Antes de instalar se comprobó dos veces que no existía ninguna guía previa para esas lecciones.

**Vacíos de la biblioteca:** ningún curso enseña TSV, el formato de Google, `StreamableFile`, escritura atómica de archivos ni sumas de comprobación de archivos. Se cubren en la [ficha 02](02-fuentes-tecnicas.md).

## Fuentes primarias y guías derivadas

| ID | Original (sección, líneas) | Guía instalada y mecanismo recuperado | Necesidad |
| --- | --- | --- | --- |
| C1 / RC1 | `NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/158. Servir archivos de manera controlada.md`, l. 13–45; contexto: guía 157 | [158 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/158. Servir archivos de manera controlada - Reconstrucción guiada.md>). El cliente envía solo el nombre; `FilesService.getStaticProductImage` compone la ruta con `join` dentro de una carpeta fija, comprueba `existsSync` y lanza un error **sin la ruta** (l. 29); el controlador responde con `@Res()` + `res.sendFile` y el instructor advierte que `@Res` se salta interceptores globales (l. 39). [Receta](reconstrucciones/recetas/backend/158-servir-archivos-controlada.json). | Claves internas en `ArtifactStore`; errores que no revelan rutas; contraste `@Res` frente a `StreamableFile` (F22). |
| C2 / RC2 | `NestJS/Reportes PDF con NestJS/Sección 3 Constancia de empleo/18. PdfMake - Primer PDF.md`, l. 13–47; contexto 17 | [18 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Reportes PDF con NestJS/Sección 3 Constancia de empleo/18. PdfMake - Primer PDF - Reconstrucción guiada.md>). El servicio construye el documento desde una definición; el controlador fija `Content-Type`, hace `pipe` a la respuesta y `end()`. Nada se guarda en disco. [Receta](reconstrucciones/recetas/reportes-pdf/18-pdfmake-primer-pdf.json). | Generar el archivo en la petición frente a guardarlo; separar serializador y transporte. |
| C3 / RC3 | `…/Reportes PDF con NestJS/Sección 3 Constancia de empleo/19. Refactorización y modularización.md`, l. 13–41 | [19 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Reportes PDF con NestJS/Sección 3 Constancia de empleo/19. Refactorización y modularización - Reconstrucción guiada.md>). Motivo: copiar la impresora en cada módulo dificulta reutilizarla (l. 13). `PrinterModule` exporta `PrinterService` con la impresora privada; los consumidores importan el módulo. Cada reporte es una función que recibe datos y devuelve la definición (`getHelloWorldReport`). [Receta](reconstrucciones/recetas/reportes-pdf/19-refactorizacion-modularizacion.json). | Extraer `ArtifactStore` a un módulo común exportado (tercer consumidor); serializador TSV como función pura. |
| C4 / RC4 | `NestJS/Microservicios con NestJS/Sección 7 Order Details - Maestro detalle/72. Grabar Orden y Detalle en base de datos.md`, l. 13–43; contexto 70 l. 21 y 71 l. 31–37 | [72 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Microservicios con NestJS/Sección 7 Order Details - Maestro detalle/72. Grabar Orden y Detalle en base de datos - Reconstrucción guiada.md>). No confiar en el precio que manda el cliente o el gateway (l. 25); con tablas relacionadas, una única inserción con todos los valores y Prisma hace la transacción (l. 35); con tablas sin relación, una transacción explícita. Error público genérico «Check logs» (l. 15). [Receta](reconstrucciones/recetas/microservicios/72-grabar-orden-y-detalle.json). | El servidor recalcula conteos y suma en lugar de aceptar los que envía el cliente; grabar exportación y exclusiones en una escritura anidada. |
| C5 / RC5 | `…/Microservicios con NestJS/Sección 7 Order Details - Maestro detalle/73. Grabar detalle y retornar información.md`, l. 13–35 | [73 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Microservicios con NestJS/Sección 7 Order Details - Maestro detalle/73. Grabar detalle y retornar información - Reconstrucción guiada.md>). `createMany` anidado con datos tomados de la fuente validada (l. 17); `include` + `select` para devolver solo lo útil (l. 25–29). [Receta](reconstrucciones/recetas/microservicios/73-grabar-detalle-y-retornar.json). | Hijos (exclusiones aceptadas) creados en la misma escritura que el padre (exportación). |
| C6 / RC6 | `NestJS/Testing en NestJS/Sección 10 E2E - Pruebas de extremo a extremo/118. E2E - Probar si es o no una imagen.md`, l. 13–39; contexto 117 l. 21 y 25 | [118 — guía](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/Testing en NestJS/Sección 10 E2E - Pruebas de extremo a extremo/118. E2E - Probar si es o no una imagen - Reconstrucción guiada.md>). Supertest con `attach`, aserciones sobre propiedades cuando el nombre cambia en cada ejecución (l. 27–29), comprobar el archivo en disco y borrarlo (l. 31–33), y la recomendación de limpiar lo que se graba (l. 39). [Receta](reconstrucciones/recetas/testing/118-e2e-probar-imagen.json). | E2E de la exportación con raíz temporal de artefactos y limpieza. |

### Contexto citado sin nueva guía

| ID | Original y líneas | Evidencia y uso |
| --- | --- | --- |
| C7 | `NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/160. Otras formas de desplegar archivos.md`, l. 27 y 29 | Servir una carpeta estática no permite controlar a quién se muestra cada archivo; el contenido queda público. Contraste: el TSV de la fase A es una descarga privada (F4), así que se descarta `ServeStaticModule`. No se reconstruye porque no aporta mecanismo aplicable. |
| C8 | `NestJS/Testing en NestJS/Sección 9 Unit Testing - Productos y carga de archivos/105. Test - Métodos del FileController.md`, l. 15–23 | Con `@Res`, el método no devuelve nada y la prueba unitaria debe simular `res.sendFile` y comprobar con qué se llamó. Con `StreamableFile` (F22) el método devuelve un valor comprobable; argumento a favor de mantener ese patrón. |
| C9 | `NestJS/Testing en NestJS/Sección 9 Unit Testing - Productos y carga de archivos/102. Test - commitTransaction.md`, l. 13 y 33 | Pruebas unitarias de una transacción con `QueryRunner` de TypeORM simulado (`commitTransaction`, `rollbackTransaction`, `release`). El proyecto usa Prisma y prueba transacciones con PGlite, así que solo sirve como contraste: simular la transacción no demuestra el efecto en la base. |
| C10 | `SQL/SQL Completo/Sección 10 Database Transactions/170. Applying Transactions & ROLLBACK.md`, l. 19 y 29; `…/173. Transactions in PostgreSQL.md`, l. 17 | Una transacción agrupa sentencias que se aplican todas o ninguna; `ROLLBACK` vuelve al estado del inicio. Fundamento de la invariante 5 (ficha 01, F2): el archivo no participa en esa garantía y debe estar completo antes del `COMMIT`. |

Guías existentes que la feature reutilizará sin regenerarlas: 155 y 157 de carga de archivos (usadas en `catalog-import`), 69 de DTOs anidados de Microservicios y las de testing de la [configuración](../../config/02-reconstrucciones-verificadas-testing.md).

**Descartados tras leerlos:** `Microservicios con NestJS/…/75. Problemas y posibles soluciones.md` (trata NATS y mensajería, no transacciones) y `Arquitectura/DDD y Microservicios/…/34. Value Object - Pattern.md` (no aporta nada a la aprobación que no cubra el dominio actual).

## Diferencia entre evidencia y adaptación

| Evidencia del curso | Interpretación limitada | Posible uso (a decidir en el plan) |
| --- | --- | --- |
| RC1: el cliente da un nombre; el servidor fija la carpeta y oculta la ruta en el error | El curso valida solo que el archivo exista; la autorización la daría otra capa. | Las descargas se resuelven por `exportId` del proyecto propio; la clave del archivo nunca sale del servidor. |
| RC1 l. 39 y F22: `@Res` se salta interceptores | El curso acepta ese coste para usar `sendFile`. | Mantener `StreamableFile` como en `errores.csv`. |
| RC2: generar en la petición, sin disco | Funciona para documentos pequeños y deterministas. | Alternativa a guardar el TSV: regenerarlo desde `evaluation_rows` (13 ms medidos para `errores.csv`, ficha 01 F15). Choca con F2/F4, que piden un archivo finalizado y verificado. |
| RC3: módulo que exporta un servicio configurado | El curso no comparte estado en disco entre módulos. | `ArtifactStore` en un módulo común con espacios de nombres (carpeta o extensión) por consumidor. |
| RC4/RC5: precio desde la fuente, no del cliente; escritura anidada transaccional | El curso lo aplica al dinero de una orden. | El cliente confirma `evaluationId` y la suma que vio; el servidor recalcula conteos y exclusiones desde `evaluation_rows` y rechaza si no coinciden. |
| RC6: aserciones estables, comprobar disco y limpiar | Usa la carpeta real `static/products`. | Raíz de artefactos temporal por suite (como en las pruebas de `catalog-import`), borrada al terminar. |
| C10: todo o nada | Concepto SQL general. | El archivo se escribe y verifica antes de la transacción que lo referencia; un fallo deja un huérfano que la limpieza retira. |

## Incertidumbres conservadas en las guías

- RC1: número de segmentos `..` en `join` (la clase dicta uno) y texto exacto del mensaje de error.
- RC2: firma del controlador, contenido de la definición y clave `Title` frente a «title» dictado.
- RC3: forma de `content` en el reporte y contenido del módulo generado por la CLI.
- RC4: el `reduce` de `totalAmount` devuelve `price * quantity` sin sumar el acumulado, tal como se dicta; la clase 73 observa que el total no cuadra sin corregirlo.
- RC6: preparación copiada de otro E2E (no mostrada), forma del cuerpo de error (inferida de Nest) y fragmento de `toContain`.

## Registro de herramientas

| Paso | Comando (desde la API) | Resultado |
| --- | --- | --- |
| Borrador de esquema | `reconstruction.py draft` sobre la 158 | Claves del JSON confirmadas. |
| Render | `reconstruction.py render --date 2026-11-01` por curso, en `reconstrucciones/salida-2026-11-01/<curso>/` | 6 guías: backend 1, reportes-pdf 2, microservicios 2, testing 1. Un primer intento de la 158 falló porque la frase de E6 no aparecía literalmente; se corrigió la frase desde el original. |
| Verificación | `reconstruction.py verify` con cada `manifest.json` | 6 verificadas, 0 escrituras; la herramienta recuerda que la fidelidad semántica requiere revisión del agente. |
| Instalación | `reconstruction.py install` | 6 guías creadas junto a sus originales; ninguna existía antes. |

La validación comprueba frases, IDs y huellas; no compila el código de los cursos ni demuestra que una cita respalde toda una conclusión.
