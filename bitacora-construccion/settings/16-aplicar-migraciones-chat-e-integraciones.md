# 16 — Aplicar migraciones de chat e integraciones

Fecha de creación: 2026-11-15  
Estado: Aplicado y verificado.  
Revisión de partida: `32caecc` con los cambios locales de integraciones.  
Relacionada con: [migraciones de Cloud SQL](07-aplicar-migraciones-y-verificar-cloud-sql.md), [contrato de integraciones](../../contracts/integrations/README.md), [cierre de la web](../../../LearningAllPosibolIt-web/docs/plans/ui/05-plan-cierre-de-la-ui.md).

El Nest de desarrollo se conecta al Cloud SQL del proyecto por Cloud SQL Auth Proxy. El estado de Prisma mostró seis migraciones pendientes, desde `20261114130000_create_ai_conversations` hasta `20261114230000_add_mcp_oauth_grants`. Sus tablas son necesarias para el listado de conversaciones y el de credenciales. Las seis ya pasaron en la base temporal de las pruebas integradas.

Aplicación autorizada de los seis archivos existentes con `pnpm db:migrate`. La verificación consulta el estado de Prisma y prueba los recorridos del entorno local usando la sesión del usuario.

Prisma aplicó las seis migraciones. `pnpm db:status` informó 41 migraciones y un esquema al día en ese punto. En la web local, el listado de credenciales y el panel de chat dejaron de devolver 500 y mostraron sus estados vacíos.

Nest quedó configurado para llamar al FastAPI local. `AI_KNOWLEDGE_SYNC_ENABLED=false` permite probar el chat con Cloud SQL sin empezar una sincronización general de documentos. Las comprobaciones HTTP de Nest y FastAPI devolvieron 200. El modelo respondió a un mensaje sintético sin datos del proyecto.
