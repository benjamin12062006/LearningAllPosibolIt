# 02 — Mensajes y errores bilingües de la API: español e inglés

Fecha de creación: 2026-10-25  
Última actualización: 2026-10-26  
Estado: Implementado y verificado.  
Ámbito: contrato transversal de mensajes JSON de la API y adopción en features actuales y futuras.  
Relacionada con: [testing de features](01-testing-nest-para-futuras-features.md), [Projects](../feature/projects&catalog-import/02-plan-projects.md), [Catalog import](../feature/projects&catalog-import/03-plan-catalog-import.md), [implementación de Projects](../../../bitacora-construccion/feature/projects&catalog-import/02-implementar-projects.md).  
Revisión de referencia: API HEAD `a551ed8b647a2ac276e23f8c3aaf2d621d5ebe35`, con cambios locales posteriores de Projects y testing; el commit no representa por sí solo todo el árbol inspeccionado.

## Objetivo y autorización

Unificar todos los errores HTTP de la API con un código estable y un mensaje que incluya siempre las dos traducciones: `es` y `en`. Cuando una respuesta exitosa necesite un mensaje para la persona, usar el mismo objeto bilingüe.

El usuario aprobó inicialmente guardar esta propuesta para ejecutarla más adelante y posteriormente ordenó su ejecución. La implementación del 2026-10-26 adopta los incrementos B0–B4; resultados y límites quedan en la [bitácora 11](../../../bitacora-construccion/settings/11-mensajes-y-errores-bilingues.md). El contenido siguiente conserva el diseño acordado y sus criterios.

## Punto de partida comprobado

La API tiene módulos `auth`, `users`, `projects` y persistencia Prisma/PostgreSQL. Las excepciones actuales contienen mensajes en español; `ProjectsService.requireConfigured` ya incluye el código `PROJECT_CONFIGURATION_REQUIRED`, pero su `message` sigue siendo un string. El `ValidationPipe` compartido usa transformación, whitelist y rechazo de campos extra. No se encontró un filtro global propio para normalizar estas respuestas.

Fuentes locales inspeccionadas:

| Fuente | Evidencia y efecto en este plan |
| --- | --- |
| [ProjectsService](../../../src/projects/projects.service.ts), findOwned/update/requireConfigured | Existen 400, 404 y 409 de negocio. Conservar sus estados y el código estable existente; traducir la presentación. |
| [DescopeSessionGuard](../../../src/auth/descope-session.guard.ts) | Los errores de sesión se producen antes del controller. La solución debe cubrir el recorrido HTTP completo. |
| [UsersService](../../../src/users/users.service.ts) y [UsersController](../../../src/users/users.controller.ts) | La adopción es transversal; no se limita a Projects o a las features que se creen después. |
| [configureHttp](../../../src/configure-http.ts) y [DTOs de Projects](../../../src/projects/projects.dto.ts) | Validación, prefijo y versión se comparten con HTTP de pruebas. La traducción de DTOs necesita una preparación específica; no basta cambiar los throws manuales. |
| [Plan de testing](01-testing-nest-para-futuras-features.md) | Las pruebas futuras usan Jest/Nest/Supertest; las suites Node existentes conservan su runner. |

El contrato siguiente es una **decisión propia acordada con el usuario**, no una receta atribuida a Fernando Herrera. Las guías del curso ya documentadas aportan montaje y comprobación de pruebas; no se afirma que enseñen este sistema bilingüe. Antes de implementar, contrastar registro de filtros, excepciones y validación con las versiones instaladas y la documentación oficial de Nest.

## Contrato acordado de error

```json
{
  "statusCode": 409,
  "code": "PROJECT_CONFIGURATION_REQUIRED",
  "message": {
    "es": "Completa el país, la moneda y el canal antes de importar.",
    "en": "Complete the country, currency, and channel before importing."
  }
}
```

| Campo | Regla |
| --- | --- |
| `statusCode` | Número igual al estado HTTP real. Un error 409 no se envía con HTTP 200. |
| `code` | Identificador técnico estable, en inglés y `UPPER_SNAKE_CASE`. Describe la causa contractual, sin depender de cómo se redacte el mensaje. |
| `message` | Objeto con exactamente `es` y `en`, ambos strings completos y no vacíos. Nunca alternar entre string, array y objeto. |
| `issues` | Lista opcional para validación por campo. Cada elemento usa `field`, `code` y `message` bilingüe. Se omite cuando no hay detalles por campo. |

El frontend muestra `message.es` o `message.en` según el idioma seleccionado; toma decisiones por `code` y estado HTTP. En la futura integración web se utilizará `es` como idioma por defecto si no existe selección. Cambiar la redacción de una traducción no debe cambiar el comportamiento del cliente.

La API devuelve ambas traducciones en cada respuesta de este contrato. Este incremento no negocia idioma mediante `Accept-Language` ni añade un parámetro `lang`. Tampoco requiere duplicar endpoints por idioma.

### Errores de validación

Una solicitud puede fallar por varios campos; el mensaje principal resume el rechazo y los detalles permiten mostrar el error junto al campo correspondiente:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": {
    "es": "Revisa los datos enviados.",
    "en": "Review the submitted data."
  },
  "issues": [
    {
      "field": "country",
      "code": "COUNTRY_INVALID",
      "message": {
        "es": "Selecciona un código de país válido.",
        "en": "Select a valid country code."
      }
    }
  ]
}
```

Traducir las reglas desde identificadores de validación o metadatos controlados. No interpretar frases en inglés de class-validator con búsquedas de texto para decidir su significado. Incluir campos obligatorios, tipos, longitudes, valores nulos, ISO, propiedades extra y parámetros de ruta. Cuando haya varias incidencias, conservarlas sin duplicados y con orden determinista. No devolver el objeto original de validación ni los valores recibidos.

## Respuestas exitosas y datos

Conservar los contratos de datos `{ project }`, `{ projects }`, `{ user }` y `{ identity }`. No envolver cada string de la API en `es/en` ni añadir mensajes a respuestas que no los necesitan.

Si una operación ya devuelve o necesita una confirmación legible, su propiedad `message` será bilingüe. Por ejemplo, una futura operación podría devolver sus datos y `message: { es: "Operación completada.", en: "Operation completed." }`. Este ejemplo no ordena añadir una confirmación a todas las rutas.

Los nombres de campos, UUID, fechas, nombres escritos por el usuario, códigos de país/moneda, estados técnicos y valores como `google_merchant` conservan su significado y formato. Los códigos se usan para lógica; las traducciones se usan para presentar mensajes.

## Diseño previsto: centralizar sin repetir traducciones

Proponer una infraestructura compartida pequeña, por ejemplo `src/common/http/`, cuya ubicación final se confirmará al ejecutar:

- Un tipo `LocalizedMessage` para `{ es: string; en: string }` y tipos de respuesta de error/validación.
- Un catálogo tipado de códigos, mensajes revisados y estados esperados. Ambos idiomas son obligatorios; no mantener diccionarios separados que puedan quedar incompletos.
- Un constructor o excepción de aplicación pequeña para seleccionar un código y los parámetros necesarios. Controllers y servicios no copian traducciones ni crean objetos Express directamente.
- Un filtro global para convertir las excepciones al contrato JSON, conservar el estado y dar una salida segura a errores inesperados.
- Normalización de validación conectada con el pipe compartido para producir códigos y detalles bilingües en lugar de arrays de frases sin estructura.

Los nombres de archivos y helpers son propuestas; no crear carpetas vacías, jerarquías de excepciones por cada mensaje ni instalar un paquete de internacionalización solo por este plan. Empezar con el catálogo y los mecanismos que la aplicación necesita. Si aparece interpolación, usar parámetros tipados y controlados en ambas traducciones.

El filtro no debe traducir automáticamente cualquier string ni inferir códigos comparando mensajes existentes. Migrar las excepciones propias a códigos explícitos. Para excepciones estándar de Nest y del adaptador HTTP, definir mapeos por tipo/estado y una alternativa genérica que conserve un estado HTTP reconocido. Para fallos desconocidos usar 500 con código y mensaje genéricos.

Los errores inesperados no exponen SQL, stack traces, tokens, credenciales ni mensajes crudos de proveedores. Los logs internos conservan diagnóstico técnico según su configuración; este plan no exige logs bilingües. Errores de arranque, CLI o compilación sin respuesta HTTP no se convierten artificialmente en JSON de API.

## Cobertura de adopción

| Área | Resultado requerido |
| --- | --- |
| Autenticación | Bearer ausente/mal formado, sesión inválida y claims insuficientes mantienen 401 con mensajes bilingües. No revelar causas internas del proveedor. |
| Usuarios | Perfil ausente y errores controlados usan códigos estables; no cambiar aprovisionamiento ni permisos. |
| Projects | Actualizar errores de propiedad, configuración parcial/vacía y configuración requerida. Conservar 404 para recurso ausente o ajeno. |
| Validación y transporte | Cuerpos/DTOs inválidos, UUID, propiedades extra, rutas inexistentes y JSON mal formado usan el contrato común. Verificar errores anteriores al controller, incluidos los emitidos por Express. |
| Persistencia/proveedores | Mantener los errores de negocio explícitos y normalizar fallos inesperados con salida genérica. La traducción no cambia reglas ni reintentos. |
| Features futuras | CatalogImportModule y siguientes reutilizan el catálogo y contrato. Al existir recepción de archivos, incluir sus errores y límites dentro del mismo formato. |

Los códigos existentes se conservan cuando su significado sigue vigente. Ejemplos por definir en el inventario: `PROJECT_NOT_FOUND`, `PROFILE_NOT_FOUND`, `AUTH_SESSION_REQUIRED`, `AUTH_SESSION_INVALID`, `VALIDATION_FAILED`, `ROUTE_NOT_FOUND` e `INTERNAL_ERROR`. La lista final se deducirá de casos reales, evitando inventar mensajes para features todavía inexistentes.

## Incrementos de ejecución futura

| Etapa | Trabajo | Criterio para continuar |
| --- | --- | --- |
| B0 — Inventario | Releer código, tests y clientes; enumerar throws, respuestas con mensajes y errores automáticos. Abrir bitácora y registrar compatibilidad. | Matriz estado/código/es/en y consumidores afectados. |
| B1 — Base común | Tipos, catálogo mínimo, construcción de errores y filtro global; primer comportamiento real con ambas traducciones. | Un error controlado y uno inesperado cumplen el contrato sin perder estado ni filtrar diagnóstico. |
| B2 — Validación | Integrar DTOs, parámetros, propiedades extra y transporte con la configuración HTTP compartida. | 400 con mensaje común e incidencias útiles; sin arrays o strings alternativos en `message`. |
| B3 — Adopción transversal | Migrar auth/users/projects y revisar respuestas exitosas con texto humano. | Todos los casos actuales inventariados usan el contrato; datos y reglas se conservan. |
| B4 — Verificación y documentación | Tests nuevos pertinentes, aserciones existentes afectadas, README/requests y cierre de bitácora. | Compilación, lint y suites pertinentes correctas; ejemplos publicados y límites registrados. |

La incorporación de ambas traducciones no requiere migraciones SQL ni cambios del modelo Prisma. El futuro trabajo de CatalogImport no debe anticiparse para implementar este contrato.

## Pruebas previstas y excepción solicitada para tests

La petición «excepto los tests» significa que no se traducen los nombres `describe/it`, comentarios, mensajes de aserción ni diagnósticos del runner. Sus textos pueden seguir en español. Las aserciones sobre respuestas HTTP sí deberán comprobar el nuevo objeto `message`, porque forman parte del contrato real; esto no convierte la suite Node a Jest.

Seguir el [plan de testing](01-testing-nest-para-futuras-features.md): Jest/Nest/Supertest para pruebas nuevas, dobles pequeños, guard real en HTTP y recursos locales temporales. Reutilizar los tests existentes sin duplicar todos los casos por idioma: una respuesta ya incluye los dos.

Comprobar al ejecutar:

1. Todo código definido tiene traducciones `es/en` completas y no vacías. Cambiar la redacción mantiene el mismo código y estado.
2. Error de negocio: forma JSON, estado, código y ambas traducciones. `PROJECT_CONFIGURATION_REQUIRED` conserva 409.
3. Sin sesión o con sesión inválida: 401, ambos idiomas y ausencia de escritura; acceso ajeno: 404 sin filtrar existencia o datos.
4. Validación: cuerpo ausente, varios campos incorrectos, campos extra, UUID inválido y JSON mal formado; incidencias estables y sin datos sensibles.
5. Ruta inexistente y excepción inesperada: contrato común, 404/500 correctos; el 500 no expone la causa interna.
6. Respuestas exitosas conservan sus datos y formas; cualquier mensaje humano añadido o existente usa el mismo tipo bilingüe.
7. Pruebas HTTP usan la misma configuración/filtro que producción; no introducir un montaje paralelo que oculte diferencias.
8. Ejecutar build, lint, suites nuevas y regresiones afectadas; registrar comandos y resultados reales. No ejecutar tests ni despliegues por el simple hecho de guardar este plan.

## Compatibilidad, límites y continuación

Cambiar `message` de string/array a objeto modifica el contrato para clientes que lo lean como texto. Durante B0, inspeccionar el consumidor web y cualquier cliente conocido antes de publicar. Coordinar su adaptación a `code` y a la selección `es/en`; si requiere modificar la UI, documentar el incremento en el proyecto web. No asumir que la ausencia de un consumidor en el repositorio demuestra que no hay clientes externos.

Por ahora se conserva `/api/v1`; antes de desplegar, revisar con el inventario si hay consumidores que exijan versionado o una transición acordada. No crear por defecto un segundo campo con el mensaje anterior ni duplicar toda la API para compatibilidad.

Este plan cubre los mensajes públicos de la API. La traducción completa de pantallas, correos, PDFs, contenido del usuario, logs y herramientas CLI requiere necesidades y planes propios. Idiomas adicionales o selección exclusiva en servidor se evaluarán después.

## Ejecución del 2026-10-26

B0–B4 implementados en [common/http](../../../src/common/http/), con adopción en auth, usuarios, Projects e importación. El filtro global sustituye al filtro particular de importación. Las respuestas de error incluyen además `requestId` generado internamente para diagnóstico; las incidencias de DTOs conservan códigos y orden determinista.

Los errores JSONB históricos de jobs y snapshots se traducen por código al leerlos, sin reescritura ni migraciones. Los errores inesperados usan 500; los fallos explícitos de almacenamiento/base de importación mantienen 503. Las respuestas exitosas mantienen sus datos. El cliente web inspeccionado decide por estado HTTP y construye mensajes propios; no requirió cambios.

La [ficha de fuentes 04](../../fonts/config/04-errores-bilingues-y-validacion.md) y la [bitácora 11](../../../bitacora-construccion/settings/11-mensajes-y-errores-bilingues.md) contienen decisiones, pruebas ejecutadas y compatibilidad. La siguiente integración de cliente puede elegir `message.es` o `message.en`; antes de publicar se deben adaptar los consumidores externos que esperen un string.
