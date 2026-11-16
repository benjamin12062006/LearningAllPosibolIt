# 08 — Chat de proyecto desde sus secciones

Fecha: 2026-11-15

[Fuentes](../../../fonts/feature/ai-assistant/10-fuentes-del-chat-de-proyecto.md) · [Contrato](../../../../contracts/chat/README.md)

1. Añadir conversaciones privadas de proyecto al modelo existente. Preservar las referencias de conversaciones de libro y hoja y exigir la pertenencia a la organización en la base.
2. Añadir la creación de proyecto por REST y GraphQL. Los mensajes, cuotas, ejecuciones y herramientas reutilizan las rutas y permisos de hoy. Un run de proyecto pasa el alcance autorizado a FastAPI con libro y hoja nulos.
3. Habilitar el compositor del panel global desde Catálogo, Reglas, Evaluaciones, Feed y Productos. Reanudar por defecto una conversación de proyecto. El usuario puede abrir las conversaciones de hojas o libros de forma explícita.
4. Reutilizar los servicios de catálogo y evaluación para leer las cabeceras, consultar reglas y comparar cambios. Presentar propuestas para guardar una revisión y lanzar una evaluación. Validar la revisión base, usar el ID de la propuesta para deduplicar y mostrar los detalles antes de confirmar.
5. Probar el recorrido de creación, mensaje, ejecución y reapertura, incluidos los permisos, las herramientas de proyecto y la compatibilidad con conversaciones anteriores.
