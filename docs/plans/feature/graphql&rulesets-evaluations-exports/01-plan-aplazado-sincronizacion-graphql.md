# 01 — Sincronización con GraphQL: aplazada al final del backend

Fecha de creación: 2026-11-02  
Estado: Plan aplazado por decisión del usuario; investigación guardada, sin código.  
Ámbito: exponer por GraphQL las features de REST que todavía no lo están, como última integración del backend.  
Relacionada con: [estado real](../../../fonts/feature/graphql&rulesets-evaluations-exports/01-estado-real-y-antecedentes.md), [fuentes técnicas](../../../fonts/feature/graphql&rulesets-evaluations-exports/02-fuentes-tecnicas.md), [cursos y reconstrucciones](../../../fonts/feature/graphql&rulesets-evaluations-exports/03-cursos-y-reconstrucciones.md), [mapa de necesidades](../../../fonts/feature/graphql&rulesets-evaluations-exports/04-mapa-de-necesidades-para-el-plan.md), [plan db/05 (capa GraphQL actual)](../../db/05-plan-implementar-graphql.md), [plan rulesets&evaluations, D12](../rulesets&evaluations/01-plan-rulesets-y-evaluations.md).  
Revisión de referencia: `f6b4bf9` en `feature/reviews-exports`, con cambios sin commit.

## Decisión

El 2026-11-02 el usuario decidió dejar la sincronización con GraphQL **para el final del backend**, como una de las últimas integraciones, y seguir antes con las features de backend que faltan. Este documento sustituye al «plan `02`» que anunciaba D12 del plan de rulesets y evaluations.

Mientras tanto:

- **Las features nuevas se construyen solo en REST.** No se añaden resolvers por cada una.
- **La capa GraphQL actual no cambia.** Sigue exponiendo `me`, proyectos, importaciones y sus mutaciones, y sus pruebas siguen como regresión.
- **La investigación queda guardada.** Fichas 01–04 y cuatro guías del curso (lecciones 43, 126, 139 y 141).

## Qué incluirá cuando se retome

1. **Inventario.** Repetir la ficha 01 con el estado del backend en ese momento: todas las operaciones REST que no tengan equivalente en GraphQL.
2. **Lo ya identificado.** Reglas, evaluaciones y exportaciones: las necesidades N1–N13 del [mapa](../../../fonts/feature/graphql&rulesets-evaluations-exports/04-mapa-de-necesidades-para-el-plan.md).
3. **Las features que se construyan antes.** Por ejemplo, la de feeds y publicaciones, con sus propias necesidades.

## Pendiente antes de escribir el plan definitivo

- **Experimento de N2.** Probar `@InputType({ isOneOf: true })` con el `ValidationPipe` global y Apollo Server 5. Comprobar:
  - el error cuando llegan dos campos o ninguno;
  - la validación de la clase anidada que se elige;
  - las rutas de los `issues`.

  Se dejó preparado el formato de los experimentos de la feature anterior y no se llegó a ejecutar.
- **Versiones.** Comprobar de nuevo las de `@nestjs/graphql`, `graphql` y Apollo Server. Las fichas se escribieron con 14.1.0, 16.14.2 y 5.5.1.
- **Esquema esperado.** Actualizar `test/features/graphql/schema.expected.graphql` y repetir la prueba de paridad de validación entre REST y GraphQL que exige el plan db/05.

## Criterio para retomarlo

Cuando las features de backend de `docs-diagrams` previstas hasta ese momento estén cerradas, o antes si el usuario lo pide. Al retomarlo, este documento pasa a «Plan» con su numeración y se escribe a continuación el plan con decisiones y etapas.
