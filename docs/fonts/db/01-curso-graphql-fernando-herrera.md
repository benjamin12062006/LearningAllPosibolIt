# 01 — Curso GraphQL de Fernando Herrera: disponibilidad y referencias

Fecha de creación: 2026-10-30  
Última actualización: 2026-10-30. **Evidencia superada:** el usuario añadió el curso en `NestJS/NestJS GraphQL` después de esta consulta. Véase la [ficha 04](04-curso-nest-graphql-reconstrucciones.md). Las secciones de `NestJS API Profesional` quedan descartadas por decisión del usuario.  
Tipo de fuente: inventario de la biblioteca local, Internet y documentación oficial  
Origen: biblioteca de transcripciones, búsqueda web y NestJS docs.  
Fecha de consulta: 2026-10-30  
Relacionada con: [plan GraphQL](../../plans/db/01-plan-graphql-desde-curso-fernando-herrera.md).

## Necesidad de consulta

El usuario quiere usar GraphQL más adelante y prefiere aprenderlo con un curso de Fernando Herrera. Antes de planificar, había que comprobar si ese curso está en la biblioteca local.

## Localización verificable

| ID | Fuente | Localizador |
| --- | --- | --- |
| F1 | Biblioteca local `/Users/benji/Documents/chrome-extencions/trancripciones/NestJS` | Contiene: `Microservicios con NestJS`, `NestJS API Profesional`, `NestJS Backend Completo`, `Reportes PDF con NestJS`, `Testing en NestJS`. |
| F2 | `NestJS API Profesional` — `Sección 26 (OLDER CONTENT) GraphQL APIs - Part 1 - Basics` y `Sección 27 (OLDER CONTENT) GraphQL - Part 2 - Authentication & Authorization + Refactoring` | Curso *NestJS Mastery*. Secciones marcadas como contenido antiguo. |
| F3 | [Comidoc: Fernando Herrera](https://www.comidoc.com/instructor/550c38655ec11) | Ficha agregadora que lista *Nest + GraphQL: Evoluciona tus APIs*. |
| F4 | [pedroobando/curso-nest-graphql](https://github.com/pedroobando/curso-nest-graphql) | Repositorio de un alumno que sigue el curso. |
| F5 | [NestJS: GraphQL quick start](https://docs.nestjs.com/graphql/quick-start) | Paquetes, drivers, *code first* y *schema first*. |

## Evidencia

- **F1:** la búsqueda en la biblioteca (`find -iname '*graph*'` y el buscador de la skill) **no encontró** ningún curso de GraphQL de Fernando Herrera. Los tres cursos de Fernando presentes son *Backend Completo*, *Testing* y *Reportes PDF*, como recoge el [README](../../../README.md).
- **F2:** el único GraphQL con NestJS de la biblioteca está en dos secciones `OLDER CONTENT` de otro instructor. El README ya establece que ese material no se usa como configuración vigente.
- **F3:** la ficha lista *Nest + GraphQL: Evoluciona tus APIs*, de Fernando Herrera, actualizado en diciembre de 2023. Al ser un agregador, el nombre, la plataforma y la vigencia deben confirmarse en Udemy o en DevTalles.
- **F4:** el repositorio organiza el curso en tres proyectos: una lista de tareas REST, la misma con GraphQL en NestJS y una aplicación «AnyList» con PostgreSQL. Es una referencia indirecta, no una transcripción.
- **F5:** con Express y Apollo se instalan `@nestjs/graphql`, `@nestjs/apollo`, `@apollo/server`, `@as-integrations/express5` y `graphql`. `@nestjs/apollo` v14 requiere Apollo Server v5. *Code first* genera el esquema desde clases y decoradores TypeScript; *schema first* parte de archivos SDL.

## Interpretación y límites

- Hoy no hay evidencia del curso pedido en la biblioteca. Ninguna decisión de GraphQL puede atribuirse todavía a Fernando Herrera.
- F3 y F4 solo sirven para identificar qué curso conseguir. No sustituyen a la transcripción.
- El curso es de 2023. Sus versiones de Apollo y Nest serán anteriores a Nest 12 y deberán contrastarse con F5, como ya se hizo con el curso de REST.

## Aplicación en el proyecto

El [plan GraphQL](../../plans/db/01-plan-graphql-desde-curso-fernando-herrera.md) arranca por conseguir y transcribir ese curso y solo después elige lecciones. No se instala ninguna dependencia de GraphQL por ahora.
