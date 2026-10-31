# 01 — GraphQL: conseguir el curso de Fernando Herrera antes de construir

Fecha de creación: 2026-10-30  
Última actualización: 2026-10-30  
Estado: Pasos 1–5 completados. El plan de implementación está en [db/05](05-plan-implementar-graphql.md). Sin código.  
Ámbito: posible capa GraphQL sobre los datos actuales. Se guarda en `plans/db` por indicación del usuario, aunque GraphQL es una capa de API y no de base de datos.  
Relacionada con: [fuente db/01](../../fonts/db/01-curso-graphql-fernando-herrera.md), [fuente db/04: lecciones y reconstrucciones](../../fonts/db/04-curso-nest-graphql-reconstrucciones.md), [plan de semillas](02-plan-semillas-de-desarrollo.md), [plan de eliminación](03-plan-eliminacion-de-datos.md).  
Revisión de referencia: `78e99f3`.

## Objetivo

Aprender y construir GraphQL siguiendo un curso de Fernando Herrera, igual que se hizo con REST. El plan estará completo cuando:

- el curso esté transcrito en la biblioteca local;
- se hayan elegido las lecciones pertinentes;
- exista un plan de implementación propio basado en esas transcripciones.

## Punto de partida

- La API es REST (`/api/v1`) con NestJS 12, Express, Prisma 7 y Descope.
- Al crear el plan, la biblioteca no contenía el curso ([fuente db/01](../../fonts/db/01-curso-graphql-fernando-herrera.md)). El mismo día el usuario añadió `NestJS/NestJS GraphQL` (Udemy `nest-graphql`, 138 lecciones) y pidió usar solo esa ruta.

## Fuentes y decisiones

- No se atribuye ninguna decisión a Fernando hasta tener la transcripción.
- **Propuesta propia:** si se adopta GraphQL, convivirá con REST en lugar de sustituirlo; ambos comparten los mismos servicios. El plan se centra solo en el backend. Esto debe validarse con el curso y con la documentación oficial.

## Incrementos

1. ✅ **Conseguir el curso.** Confirmar el título y la plataforma (Udemy o DevTalles) y transcribirlo en `trancripciones/NestJS/<nombre del curso>/`, con el mismo formato que los demás cursos.
2. ✅ **Inventariar.** Con `buscar-aprendizaje-en-cursos`, mapear sus secciones: resolvers, queries, mutations, inputs y validación, relaciones, paginación, autenticación y PostgreSQL.
3. ✅ **Seleccionar y reconstruir.** Con `construir-desde-cursos`, elegir y reconstruir las lecciones pertinentes en `docs/fonts/db/reconstrucciones/`.
4. ✅ **Contrastar versiones.** Comparar con la documentación vigente de NestJS GraphQL (Nest 12, `@nestjs/apollo` y Apollo Server, *code first* o *schema first*).
5. ✅ **Escribir el plan de implementación** en [05-plan-implementar-graphql.md](05-plan-implementar-graphql.md). Debe cubrir el primer recurso (por ejemplo, `projects` en solo lectura), la reutilización de los servicios existentes, la autorización con Descope en el contexto GraphQL, el contrato de errores bilingüe y el límite de peticiones.

## Resultado de los pasos 1–4 (2026-10-30)

Se reconstruyeron 19 lecciones (R1–R19) con `reconstruir-cursos-con-scripts`: `verify` comprobó las 19 guías y 25 originales, e `install` las dejó junto a cada transcripción. El inventario, el criterio de selección, el contraste de versiones y la relación con el proyecto están en la [fuente db/04](../../fonts/db/04-curso-nest-graphql-reconstrucciones.md). Las secciones `OLDER CONTENT` de `NestJS API Profesional` se descartaron por decisión del usuario.

## Comprobación prevista

Este plan no tiene código que comprobar. Su resultado es la transcripción disponible y localizable con el buscador, más una ficha de fuente nueva con las lecciones elegidas.

## Límites y continuidad

- No instalar dependencias ni crear resolvers hasta completar los incrementos 1–4.
- Prioridad baja: va después de las semillas, la eliminación y los ajustes de [projects&catalog-import/04](../feature/projects&catalog-import/04-plan-ajustes-limites-y-consultas.md).
