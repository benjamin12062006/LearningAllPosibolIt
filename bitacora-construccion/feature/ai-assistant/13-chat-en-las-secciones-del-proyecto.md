# 13 — Chat en las secciones del proyecto

Fecha: 2026-11-15  
Estado: Implementado en local.

[Fuentes](../../../docs/fonts/feature/ai-assistant/10-fuentes-del-chat-de-proyecto.md) · [Plan](../../../docs/plans/feature/ai-assistant/08-plan-chat-de-proyecto.md) · [Migraciones iniciales](../../settings/16-aplicar-migraciones-chat-e-integraciones.md)

Catálogo, Reglas, Evaluaciones, Feed y Productos abren el mismo panel. Se puede iniciar una conversación privada del proyecto desde cualquiera de esas vistas. La conversación guarda libro y hoja vacíos. Las conversaciones que ya estaban vinculadas a un libro o una hoja conservan su origen.

La pasarela puede consultar las cabeceras de un catálogo y comparar un mapeo y reglas candidatos con una revisión guardada. Para guardar una revisión o encolar una evaluación, el agente prepara una propuesta que muestra el efecto y espera la decisión de la persona. Nest comprueba el permiso vigente y la revisión base al confirmar. La revisión o evaluación se asocia al ID de la propuesta para recuperar una repetición. El panel enlaza al resultado.

Pasaron 74 pruebas del backend de conversaciones, ejecución, GraphQL, cobertura y conocimiento, además de 191 pruebas web y la comprobación de tipos de Nuxt. La prueba integrada usa PostgreSQL temporal y comprueba la privacidad, el recorrido de reglas y evaluación y el reintento de la confirmación. FastAPI respondió a un mensaje sintético. La migración `20261115100000_add_project_conversations` se aplicó al Cloud SQL usado por Nest de desarrollo y `pnpm db:status` informó 42 migraciones al día. La comprobación de la nueva interfaz queda para el usuario en su navegador.
