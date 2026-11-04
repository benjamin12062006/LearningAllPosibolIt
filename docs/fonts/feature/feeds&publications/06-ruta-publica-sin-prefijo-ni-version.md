# 06 — Ruta pública sin prefijo ni versión (E2)

Fecha de creación: 2026-11-02  
Estado: Fuentes consultadas para la etapa E2; se aplican en la [bitácora 02](../../../../bitacora-construccion/feature/feeds&publications/02-url-publica-cache-y-retencion.md).  
Tipo de fuente: documentación oficial de NestJS.  
Fecha de consulta: 2026-11-02 (todas las URL de esta ficha)  
Revisión del proyecto: `f6b4bf9` con los cambios sin commit de E1.  
Relacionada con: [plan 01](../../../plans/feature/feeds&publications/01-plan-feeds-y-publicaciones.md) (D7, D8), [fuentes técnicas](02-fuentes-tecnicas.md) (F23, F24).

## Necesidad

La API usa el prefijo global `api` y versionado URI con `defaultVersion: '1'`. El TSV publicado tiene que servirse en `/feeds/<token>.tsv`, sin `/api` ni `/v1` (docs-diagrams/07). F24 ya mostró que `exclude` quita el prefijo pero conserva el segmento de versión. Falta saber cómo quitar también la versión.

## Fuentes

| ID | Fuente y sección | Qué establece (paráfrasis) | Uso en E2 |
| --- | --- | --- | --- |
| F31 | [NestJS: Versioning](https://docs.nestjs.com/techniques/versioning), «Version "Neutral"», «URI Versioning Type» y «Global default version» | Un controlador o una ruta se declara neutral con `version: VERSION_NEUTRAL`. Con versionado URI, un recurso neutral no lleva la versión en su URI. `defaultVersion` se aplica a lo que no declara versión; la página no detalla qué hace un controlador neutral junto a un `defaultVersion` numérico. Un controlador neutral debe registrarse después de los versionados que compartan su ruta. | `@Controller({ path: 'feeds', version: VERSION_NEUTRAL })` más `exclude` del prefijo (F24). Ninguna otra ruta empieza por `feeds` fuera de `projects/:id/`, así que el orden no importa. La combinación exacta se comprueba con una prueba E2E: `/feeds/<token>.tsv` responde y `/api/v1/feeds/…` y `/v1/feeds/…` no. |

## Sin fuente oficial leída (se comprueba con pruebas)

- **`HEAD` atendido por la ruta `GET` en Express.** La página de la API de Express 5 que se consultó no lo trata. Se comprueba con una prueba E2E: `HEAD` devuelve las mismas cabeceras sin cuerpo.
- **`ETag` automático de Express.** Solo lo calcula `res.send` con el cuerpo en memoria; con un `StreamableFile` no hay `ETag` ni `304` automáticos (también por conocimiento general, no por una página leída). Por eso la API calcula el `ETag` y compara `If-None-Match` ella misma, con la comparación débil de F23.

## Límites

- No se consultó el código fuente de `@nestjs/core` para el registro de rutas neutrales: la prueba E2E es la evidencia.
