# 01 — Semilla funcional de KTSU

Fecha de creación: 2026-11-14  
Estado: En curso.  
Relacionada con: [fuentes](../../../fonts/feature/semilla/01-fuentes-semilla-nest.md).  
Revisión de partida: `32caecc` y las integraciones en el árbol de trabajo.

1. Preparar un PGlite local por perfil, con migraciones y almacén de artefactos propios. Publicar la semilla completa mediante un cambio atómico de directorio. La copia de trabajo que sirve la API se crea desde la semilla y conserva sus propios archivos.
2. Usar los providers de Nest en un contexto de aplicación y los mismos servicios que reciben REST. Cargar personas, organizaciones, hojas, borradores, catálogo, evaluación, feed y conversación. Los IDs de los usuarios sintéticos se fijan en el script. El manifiesto conserva los IDs creados por otros servicios al volver a ejecutar la semilla.
3. Ofrecer perfil pequeño y perfil de 5.000 filas. Usar sesiones sintéticas solo en el servidor de demostración en loopback. Permitir una vinculación explícita del usuario Owner con la identidad de prueba de Descope.
4. Comprobar repetición, reset acotado a la plantilla, permisos de lectura, archivos y operaciones REST y GraphQL.
