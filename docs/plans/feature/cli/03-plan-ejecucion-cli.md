# 03 — Implementación y aceptación de la CLI de KTSU

Fecha de creación: 2026-11-21  
Estado: En curso  
Relacionada con: [plan de catálogo y distribución](02-plan-catalogo-completo-y-distribucion-cli.md), [fuentes de la CLI](../../../fonts/feature/cli/01-fuentes-cli-ktsu.md) y [bitácora](../../../../bitacora-construccion/feature/cli/01-catalogo-y-sesion-cli.md).

## Entrega

1. Exponer las 18 operaciones en la ruta CLI reutilizando los casos de uso del asistente. Descubrimiento e invocación consultan la misma política. Verificar nombres, selectores, roles, ámbito y códigos de error con PostgreSQL.
2. Completar el flujo `read → prepare → revisar en la web → status`. Verificar idempotencia, revocación, expiración, estados terminales y descargas de hojas confirmadas. La política de confirmación de la CLI debe exigir revisión humana aunque el chat tenga auto-confirmación.
3. Permitir login OAuth con un Inbound App público y un API Resource dedicado en Descope. Usar PKCE S256, `state` y `http://127.0.0.1/callback` con puerto efímero. Verificar el cliente, la audiencia, los scopes, la concesión del usuario y el proyecto en Nest. Guardar y renovar la sesión desde el llavero. El token opaco seguirá disponible para entornos automatizados. [Descope](https://docs.descope.com/identity-federation/inbound-apps/creating-inbound-apps) · [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)
4. Incluir el ejecutable, el flujo de acceso y los recorridos en una skill versionada del repositorio. En Integraciones, mostrar el árbol y el contenido exacto de todos sus archivos con Nuxt UI. Permitir copiar un archivo o todo el árbol para reconstruirlo desde un agente. Quitar descargas y comandos de instalación de la pestaña CLI. Reusar la pantalla de revisión.
5. Ejecutar el paquete directamente dentro de la skill con pnpm y probar que los archivos copiados coincidan con el repositorio. Ejecutar los comandos con una API de prueba y comprobar la migración y las suites de Nest y Nuxt. Registrar por separado la autorización real de Descope y la prueba de producción, que dependen de la disponibilidad del entorno desplegado.

## Recorrido del feed

Cubrir creación, diagnóstico de entrega, productos, versiones, actualización inmediata y consulta del trabajo, republicación, desactivación, fuente, política y horario. Crear o rotar la URL pública abre la pantalla de Feed para que la persona reciba el secreto de entrega una sola vez.

## Vincular Descope a Nest

Crear un API Resource propio de la CLI, por ejemplo `https://ktsu-api.vercel.app/api/v1/integrations`, con `ktsu:cli:read` y `ktsu:cli:prepare`. Crear el Inbound App público con Authorization Code y registrar `http://127.0.0.1/callback`. Conceder ambos scopes a ese Inbound App mediante una política del recurso. Configurar en Vercel `CLI_OAUTH_CLIENT_ID`, `CLI_OAUTH_ISSUER` y `CLI_OAUTH_RESOURCE_URL`. Nest valida el `azp` del cliente, la audiencia propia y la concesión KTSU. [Configurar Inbound Apps](https://docs.descope.com/identity-federation/inbound-apps/creating-inbound-apps) · [Configurar Resources](https://docs.descope.com/resources/managing-resources)

Antes de actualizar la API publicada, verificar en Neon ambas migraciones de propuestas y concesiones. Verificar acceso web y lectura CLI con `Personal · Prueba`. Para el incidente de almacenamiento, registrar por separado qué archivos siguen devolviendo 503 después de la publicación.
