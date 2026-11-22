# 04 — MCP remoto por proyecto

Fecha de creación: 2026-11-21  
Relacionada con: [plan de MCP por proyecto](../../../docs/plans/feature/cli/04-plan-mcp-por-proyecto.md).

La pantalla Integraciones devolvía la URL del MCP solo para el proyecto y la organización configurados en Nest. La CLI ya buscaba una concesión por proyecto. Nest comparte esa búsqueda por audiencia y expone un enlace con selector explícito para los otros proyectos. La URL anterior conserva el alcance del piloto.

El transporte reenvía el proyecto por la ruta interna autenticada y comprueba que Nest lo confirme. La audiencia OAuth de Descope sigue siendo el servidor `/mcp`. Un selector incorrecto, una concesión ausente o una revocación impiden operar sobre ese proyecto. La web usa un nombre de conexión distinto por proyecto.

La suite de Integraciones cubre la concesión para dos proyectos, el rechazo de un proyecto ajeno y la revocación. Las pruebas del transporte cubren el rechazo de selectores duplicados y la compatibilidad segura durante el despliegue. La suite web verifica los enlaces y nombres de conexión y rechaza parámetros que podrían contener secretos.
