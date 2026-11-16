# 01 — CLI y skill para la API de KTSU

Fecha de creación: 2026-11-14  
Estado: En curso.  
Relacionada con: [fuentes](../../../fonts/feature/cli/01-fuentes-cli-ktsu.md) y [plan de acceso externo](../ai-assistant/07-plan-acceso-externo-y-cli.md).

1. Añadir el transporte CLI al catálogo de Nest con una credencial de audiencia `cli`, proyecto y capacidades vigentes. Confirmar propuestas por la ruta humana.
2. Implementar el binario sin dependencias de terceros, con perfiles de URL, errores en stderr, entrada privada del token y salida JSON. Mantener la deduplicación de `callId`.
3. Versionar la skill y sus referencias junto al binario. Comprobar la ruta de trabajo de la skill con el Nest real y datos sintéticos. El piloto local valida la utilidad del catálogo y la ergonomía de scripts sin depender del despliegue del MCP remoto.
