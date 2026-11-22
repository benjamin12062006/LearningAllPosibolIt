# 04 — Autorizar el MCP remoto por proyecto

Fecha de creación: 2026-11-21  
Relacionada con: [paridad del MCP y la CLI](../../../../bitacora-construccion/feature/cli/02-paridad-del-mcp-con-la-cli.md) y [contrato externo](../../../../contracts/integrations/README.md).

El piloto fija un proyecto por variables de Nest. La CLI demuestra cómo recuperar una concesión activa desde el identificador explícito del proyecto. El MCP comparte ese mecanismo y conserva la URL sin selector para clientes del piloto.

- Descope conserva el emisor y la audiencia canónica de `/mcp`. Un parámetro `project` identifica el proyecto de KTSU y viaja a Nest por el canal interno autenticado. [Autorización de MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#resource-parameter-implementation)
- Nest verifica la concesión de ese proyecto, su titular y su membresía, y cruza el permiso concedido con los scopes de Descope. Si el proyecto explícito falla, la llamada se rechaza.
- Integraciones presenta un nombre de conexión propio para cada proyecto nuevo. El servidor MCP se despliega primero y comprueba que Nest confirme el mismo proyecto antes de servir herramientas. Verificar aislamiento, revocación, compatibilidad con el proyecto piloto y conexión real.
