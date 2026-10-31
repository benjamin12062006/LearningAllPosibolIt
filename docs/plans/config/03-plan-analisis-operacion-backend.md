# 03 — Análisis de lo que falta en el backend para operar (Nest + Prisma)

Fecha de creación: 2026-10-30  
Estado: Plan de análisis. Investigación ampliada pendiente por indicación del usuario.  
Ámbito: operación, despliegue y documentación de la API; no incluye features de producto.  
Relacionada con: [fuente config/05](../../fonts/config/05-operacion-nest-salud-limites-openapi.md), [plan de migraciones remotas](../db/04-plan-migraciones-remotas-y-fechas.md), [plan de eliminación](../db/03-plan-eliminacion-de-datos.md), [fases del producto](../../../../docs-diagrams/03-fases-y-diagramas.md).  
Revisión de referencia: `78e99f3`.

## Objetivo

Listar y priorizar lo que necesita la API para ejecutarse fuera de esta Mac y llegar al piloto. Cada punto se analizará con fuentes y, si se aprueba, tendrá su propio plan. El análisis estará completo cuando cada punto tenga una decisión: hacer ahora, antes del piloto o descartar.

## Punto de partida

- **Red:** la API escucha en `127.0.0.1` y puerto `PORT` ([main.ts](../../../src/main.ts)). Dentro de un contenedor no recibiría tráfico externo.
- **CORS:** los orígenes están fijos en el código ([configure-http.ts](../../../src/configure-http.ts)).
- **Ya existe:** `enableShutdownHooks`, cierre ordenado del worker, `requestId` en los errores y logs con `Logger` de Nest.
- **No existe:**
  - una ruta de salud;
  - un límite de peticiones;
  - documentación OpenAPI;
  - un Dockerfile o configuración de despliegue;
  - copias de seguridad conjuntas de la base y los archivos.

## Puntos a analizar

| # | Punto | Por qué | Fuente inicial | Prioridad propuesta |
| --- | --- | --- | --- | --- |
| O1 | Health check (`/api/health` o en la raíz) con estado de la base y del disco de `CATALOG_IMPORT_ROOT` | La plataforma de despliegue necesita saber si la API está viva | F2, F5 de la [fuente config/05](../../fonts/config/05-operacion-nest-salud-limites-openapi.md) | Antes del despliegue |
| O2 | Límite de peticiones global y más estricto en `POST imports` | Evitar abusos y cargas repetidas | F6 | Antes del piloto |
| O3 | OpenAPI/Swagger de las rutas `/api/v1` | Contrato de la API documentado para quien la consuma; el curso lo enseña en la sección 14 | F1, F4 | Después de semillas y eliminación |
| O4 | `HOST` y orígenes CORS configurables por entorno | Desplegar sin tocar el código | Sección 9 del curso (pendiente de leer) | Antes del despliegue |
| O5 | Dockerfile y despliegue (Cloud Run u otro) con un volumen privado persistente | La operación inicial exige una instancia y un volumen | Secciones 9 y 16 del curso (pendientes de leer) | Antes del piloto |
| O6 | Copias de seguridad y restauración conjuntas de la base y los archivos | Lo exige el [plan de decisiones 09](../../../../docs-diagrams/09-decisiones-y-plan-de-construccion.md) antes del piloto | Sin fuente consultada | Antes del piloto |
| O7 | Cabeceras de seguridad HTTP (por ejemplo, Helmet) | Protección básica en producción | Sin fuente consultada | Por analizar |
| O8 | Logs estructurados y correlación por `requestId` en todas las rutas | Diagnosticar fallos en el entorno desplegado | Sin fuente consultada | Por analizar |

## Incrementos del análisis

1. Leer las fuentes pendientes (secciones 9 y 16 del curso; documentación de Helmet y logging) y completar la fuente config/05 o crear la 06.
2. Decidir la prioridad final de O1–O8 con el usuario.
3. Crear un plan propio en `docs/plans/config/` para cada punto aprobado, con el número siguiente.

## Comprobación prevista

Este análisis no tiene código que comprobar. Cada plan que salga de él definirá sus propias pruebas.

## Límites y continuidad

- No instala dependencias ni cambia `main.ts`.
- Los temas de base de datos (semillas, eliminación, migraciones remotas y fechas) están en `docs/plans/db/`. GraphQL está en [db/01](../db/01-plan-graphql-desde-curso-fernando-herrera.md).
