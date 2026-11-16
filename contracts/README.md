# Contrato GraphQL de la API

Lo que usan los clientes de `/api/graphql`, guardado aquí para que las pruebas lo comprueben en cada cambio del esquema (plan C7, etapa C7.5).

| Carpeta | Qué es | Lo comprueba |
| --- | --- | --- |
| `graphql/agent/` | Las operaciones predefinidas del agente (FastAPI). No usan ninguna de las 24 que la ficha 05 le prohíbe. | `test/features/graphql/contracts.spec.ts` |
| `graphql/nuxt/` | Una por pantalla de la web: lo que pide cada pantalla en una llamada. | `test/features/graphql/contracts.spec.ts` |
| `python/` | Cliente mínimo (solo biblioteca estándar) y la comprobación del contrato contra Nest arrancado: dos organizaciones, credencial inválida, límite de coste y errores como en REST. | `test/features/graphql/python-contract.e2e-spec.ts` |

Cada operación tiene que ser válida con `test/features/graphql/schema.expected.graphql`, caber en la profundidad máxima (8) y costar como mucho 1.000 con sus límites.

El cliente del agente de verdad lo escribe la sesión de FastAPI a partir de este contrato. La identidad delegada del agente (un token por ejecución) es de E6.3a: aquí el cliente llama con la sesión Bearer de una persona, como la web.
