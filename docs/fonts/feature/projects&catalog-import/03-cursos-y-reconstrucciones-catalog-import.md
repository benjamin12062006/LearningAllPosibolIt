# 03 — Cursos y reconstrucciones para CatalogImportModule

Fecha de creación: 2026-10-25  
Estado: Tres guías reconstruidas, revisadas, verificadas e instaladas; Plan 03 actualizado, importador no implementado.  
Tipo de fuente: transcripciones originales, evidencia derivada y registro de herramientas.  
Origen: Fernando Herrera/DevTalles; curso local `NestJS Backend Completo`, vinculado en los originales a `nest-framework` de Udemy.  
Fecha de consulta: 2026-10-25  
Relacionada con: [Plan 03](../../../plans/feature/projects&catalog-import/03-plan-catalog-import.md), [fuentes técnicas](02-fuentes-tecnicas.md), [antecedentes del proyecto](01-estado-real-y-antecedentes.md), [plan de testing](../../../plans/config/01-testing-nest-para-futuras-features.md), [manifiesto](reconstrucciones/salida-catalog-import-2026-10-25/manifest.json).

## Necesidad y selección

Esta ficha conserva la preparación del 2026-10-25. La ejecución posterior de la API está registrada en [fuente 05](05-implementacion-catalog-import.md) y [bitácora 03](../../../../bitacora-construccion/feature/projects&catalog-import/03-implementar-catalog-import.md); las afirmaciones de «pendiente» de esta preparación corresponden a su fecha original.

La petición es mejorar el plan de la feature que recibe un CSV de proyecto y guarda snapshot, filas, estado y errores. Se ejecutó la búsqueda local con `search_transcripts.py`, consulta Nest/carga/archivos/transacciones y término `FileInterceptor`; se inventariaron las secciones antes de seleccionar lecciones. La referencia principal es el curso backend de Fernando Herrera que ya utiliza el proyecto.

Raíz del curso: `/Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo`. El campo Curso de los originales contiene el subtítulo «REST, TypeScript, Websockets, Autenticación, Authorización, Docker, Mongo, Postgres, TypeOrm,». Se conserva como metadato de la fuente, sin deducir versiones actuales de él.

Se leyeron completos seis originales: 154–157 de carga, y 144–145 de transacciones. Se reconstruyeron tres lecciones; las otras aportan únicamente el contexto indispensable. Las clases seleccionadas enseñan imágenes y TypeORM, no un importador CSV, parser streaming, snapshots ni jobs. Esos aspectos se fundamentan en requisitos del producto y documentación técnica oficial, con adaptación explícita.

## Fuentes primarias y guías derivadas

| ID | Original, sección y localizadores | Guía y mecanismo recuperado |
| --- | --- | --- |
| C1 / RC1 | [155. Validar archivos](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/155. Validar archivos.md>), sección 12, líneas 19–29 y 35–41; «tres argumentos», «automáticamente», «400» | [Guía instalada 155](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/155. Validar archivos - Reconstrucción guiada.md>). Tres fases y diez evidencias: helper de filtro, callbacks de aceptación/rechazo y control del archivo obligatorio en el controlador. [Receta](reconstrucciones/155-validar-archivos.json). |
| C2 / RC2 | [157. Renombrar el archivo subido](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/157. Renombrar el archivo subido.md>), sección 12, líneas 15–29 y 33; «nuevo nombre», «Hola mundo», «B4», «Static Products» | [Guía instalada 157](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/157. Renombrar el archivo subido - Reconstrucción guiada.md>). Tres fases y nueve evidencias: callback filename, UUID y barril; una ruta física no constituye URL pública. [Receta](reconstrucciones/157-renombrar-archivo.json). |
| C3 / RC3 | [145. Transacciones](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 11 Relaciones en TypeORM/145. Transacciones.md>), sección 11, líneas 15–35 y 39–45; «Manager», «rollback», «release», «objeto plano» | [Guía instalada 145](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 11 Relaciones en TypeORM/145. Transacciones - Reconstrucción guiada.md>). Tres fases y diez evidencias: operaciones relacionadas en una transacción y cierre de recursos. Solo se recupera el método update; la clase heredada queda incompleta. [Receta](reconstrucciones/145-transacciones.json). |

Contexto primario mínimo:

- [154. Subir un archivo al backend](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/154. Subir un archivo al backend.md>), líneas 19–39: recurso Files, UploadedFile, FileInterceptor y nombre del campo multipart. Aporta contexto a RC1; no se generó otra guía de esta clase.
- [156. Guardar imagen en filesystem](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 12 Carga de archivos/156. Guardar imagen en filesystem.md>), líneas 13–29: volatilidad, directorio fuera de público y diskStorage; contexto de RC2. No se atribuye persistencia garantizada al disco del servidor.
- [144. Query Runner](</Users/benji/Documents/chrome-extencions/trancripciones/NestJS/NestJS Backend Completo/Sección 11 Relaciones en TypeORM/144. Query Runner.md>), líneas 23–39: necesidad de revertir operaciones relacionadas, preparación de update y DataSource; contexto de RC3.

## Diferencia entre evidencia y adaptación

| Evidencia | Interpretación limitada | Decisión en Plan 03 |
| --- | --- | --- |
| RC1: callback false y comprobación `if (!file)` | Rechazar el archivo no implica por sí solo una excepción HTTP. El MIME declarado del ejemplo no verifica bytes. | Archivo obligatorio y errores explícitos; parser/decodificador verifican el CSV. No copiar la whitelist de imágenes como prueba de validez de catálogo. |
| RC2: UUID y destino de storage | Diferencia nombre del cliente, identidad física y acceso público. No demuestra creación exclusiva ni durabilidad. | Clave interna, no sobrescritura probada, volumen privado y sin URL del original. |
| RC3: manager transaccional, commit/rollback y release | Las escrituras SQL del mismo contexto pueden ser atómicas. No incluye disco; una lectura después de commit no pertenece a esa unidad. | Prisma `$transaction` con `tx` compartido y bloques cortos; archivo finalizado antes del alta; compensación y reconciliación separadas. |
| F13: body parcial durante callbacks y storage explícito | Los campos multipart no tienen orden garantizado. Sin opciones no se debe asumir temporal en disco. | Autorizar con ruta/identidad antes de carga, elegir claves sin body y validar campos después de recepción. |
| F15: interceptores antes de pipes | Un pipe puede fallar cuando ya existe un archivo. | Envoltura de limpieza exterior al controlador, incluyendo rechazo de DTO. |

La búsqueda acotada de CSV en las lecciones seleccionadas no aporta una implementación de parser. Los requisitos de UTF-8 estricto, comillas/saltos, IDs textuales, unicidad, lotes y snapshots completos son propios; F8/F16 de la ficha técnica orientan sus mecanismos. No se generó un supuesto código CSV del instructor a partir de ejemplos de imágenes.

## Incertidumbres conservadas en las guías

RC1 recupera con certeza los valores jpg/png/gif mencionados; una pronunciación duplicada de JPG no permite asegurar la lista completa. La guía no añade otro valor como literal del vídeo. Las grafías de mensajes se normalizan y el callback `Function` permanece como estilo del ejemplo, no recomendación de tipado para esta API.

RC2 normaliza la pronunciación de `fileNamer` y conserva los métodos heredados. La extensión se deriva del MIME del ejemplo; para nuestro almacenamiento CSV será una convención del servidor, no un valor confiable aportado por cliente. Las garantías de no sobrescritura y privacidad se prueban en el adaptador propio.

RC3 declara que no se dispone del ProductsService completo: muestra el método update recuperable y sus dependencias heredadas, sin inventar métodos auxiliares. No se copia un QueryRunner a Prisma ni se afirma que rollback deshaga un commit ya confirmado. Fallos de conexión/liberación posteriores requieren decisiones adicionales; el plan no oculta esa diferencia entre ejercicio y producto.

## Ejecución real de reconstruir-cursos-con-scripts

Script: `/Users/benji/.agents/skills/reconstruir-cursos-con-scripts/scripts/reconstruction.py`.

| Paso | Resultado |
| --- | --- |
| Inventarios por lección 155, 157 y 145 | Originales y secciones confirmados; no existían guías correspondientes en las secciones revisadas. |
| `draft` para cada original | Tres recetas creadas como draft en `reconstrucciones/`. |
| Revisión de recetas | Lectura completa, localizadores/frases, niveles de certeza, fases y código final recuperable; estado ready tras contraste. |
| `render` de las tres recetas | `rendered: 3`, `library_written: false`; salida nueva en `reconstrucciones/salida-catalog-import-2026-10-25/`. Validación de frases por línea, IDs y estructura. |
| Lectura de la salida | Los tres Markdown generados se leyeron y contrastaron con originales/contexto antes de verificar. |
| `verify` | `verified: 3`, `originals: 6`, `writes: 0`; huellas de originales y salidas concordantes. No es una compilación ni una prueba semántica automática. |
| `install` | Tres guías nuevas junto a originales, ninguna sobrescrita; elevación autorizada para escribir en la biblioteca externa. |

Se conservan las recetas y el manifiesto para repetir la comprobación. Abrir las guías instaladas desde RC1–RC3; las copias de staging conservan enlaces relativos preparados para su ubicación final junto al original.

Después de actualizar los documentos se repitió `verify` con resultado tres guías/seis originales; la comparación de las tres guías instaladas con el manifiesto también coincidió. La revisión documental de los tres planes, las tres fichas y las tres salidas generadas comprobó 101 enlaces locales sin destinos ausentes, interpretando los relativos de staging desde la ubicación instalada. No equivale a renderizado visual ni ejecución de la aplicación.

## Resultado y pendiente

El Plan 03 ahora separa recepción/aceptación, parser, persistencia y trabajo; explicita orden de autorización/validación, limpieza antes de controller, unidades de límites, coherencia de estados y commit incierto. Añade una matriz de diez escenarios para probar esos límites.

No se crearon fuentes ejecutables de CatalogImportModule, migraciones o tests; tampoco se compiló el curso o se consultó/escribió Cloud SQL. El siguiente trabajo de aplicación sigue siendo implementar C1 después de projects y la base de testing, verificando las versiones reales y los casos del plan.
