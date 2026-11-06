# 01 — Política de recuperación de actualizaciones

Fecha de creación: 2026-11-02  
Última actualización: 2026-11-05 (cierre)  
Estado: Cerrada. El núcleo D4 (`refresh-retry.ts`) se revisó y se reutiliza en E4; allí se cambiaron dos códigos definitivos que no existían por los reales. La verificación está en la [bitácora 04 de feeds&publications](../feeds&publications/04-trabajo-de-actualizacion-con-lease.md).  
Revisión de partida: f6b4bf9 con cambios ajenos E1/E2.  
Relacionada con: [plan](../../../docs/plans/feature/feed-refresh/01-e4-trabajos-y-reintentos.md), [fuentes](../../../docs/fonts/feature/feed-refresh/01-reintentos-y-contratos.md).

Implementación independiente del núcleo D4. No modifica archivos de E3 ni registra workers/rutas todavía. Verificación y continuidad se completan al terminar las pruebas.
