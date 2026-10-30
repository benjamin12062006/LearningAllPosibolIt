# Guía de peticiones HTTP

Fecha de creación: 2026-09-22
Última actualización: 2026-10-26
Relacionada con: [entorno HTTP](../../bitacora-construccion/http/01-entorno-privado-y-peticiones-webstorm.md), [fuentes oficiales](../fonts/http/01-http-client-webstorm-y-httpyac.md)

Las peticiones de `requests/` funcionan con HTTP Client de WebStorm y con
[httpYac](https://httpyac.github.io/) desde la terminal. Ambos usan el entorno `local`.

## WebStorm

1. Ejecuta `pnpm api:auth-test` para generar o renovar la sesión.
2. Mantén Nest activo con `pnpm start:dev` para tus peticiones manuales. Si el
   comando anterior inició una API temporal, la detuvo al terminar.
3. Abre un `.http` de `requests/` y selecciona **local** en **Run with**.
4. Ejecuta la petición desde el botón junto a su nombre.

`http-client.env.json` comparte `apiUrl`; `http-client.private.env.json` guarda
`local.TEST_SESSION_JWT`. El script actualiza solo ese token y conserva las otras
variables y entornos. No añadas el JWT al JSON público.

```http
### Con sesión: el token temporal se genera con pnpm api:auth-test
# @name authenticated
GET {{apiUrl}}/auth/me
Accept: application/json
Authorization: Bearer {{TEST_SESSION_JWT}}
```

## Comandos

Seleccionar manualmente una petición:

```bash
pnpm api:request
```

El comando ya selecciona `local`. Para enviar una petición por nombre:

```bash
pnpm api:request --name authenticated
```

Obtener una sesión temporal de un usuario de prueba de Descope y ejecutar únicamente
la petición autenticada:

```bash
pnpm api:auth-test
```

Este es un comando integral: comprueba o inicia Nest, crea o reutiliza el usuario
tester, genera una sesión temporal y ejecuta httpYac. El procedimiento completo está
documentado en
[`01-prueba-auth-end-to-end.md`](01-prueba-auth-end-to-end.md).

## Proyectos e importaciones

Tras generar sesión, ejecuta `provisionCurrentUser` en `users.http` y después
`createProject` en `projects.http`. El handler captura `projectId` automáticamente.
En `catalog-import.http`, `acceptCatalogImport` captura `jobId` y `snapshotId`;
después puedes consultar `getImportJob` y `getImportSnapshot`. Repite la consulta
del job si todavía está `queued` o `running`.

Los IDs capturados duran hasta cerrar WebStorm o terminar el proceso httpYac.
Para usar recursos existentes o comandos CLI separados, añade sus IDs al entorno
`local` del JSON privado. Esos valores de entorno tienen prioridad sobre los
globales en WebStorm: quítalos si vuelves a usar captura automática.
En CLI también puedes pasar `--var projectId=... jobId=... snapshotId=...`.
Selecciona peticiones individuales cuando quieras evitar repetir escrituras;
**Run All** también ejecuta creación, edición e importación.

## Secretos

Los archivos `.http`, la documentación y Git nunca deben contener JWT, refresh tokens
ni Management Keys reales. El script guarda la sesión temporal en
`requests/http-client.private.env.json`, ignorado por Git y con permisos `0600`.
Las peticiones la leen mediante `{{TEST_SESSION_JWT}}` al seleccionar `local`.
Ya no se genera `requests/.env`.

Las credenciales locales se guardan en `.env`, ignorado por Git:

```dotenv
DESCOPE_PROJECT_ID=...
DESCOPE_MANAGEMENT_KEY=...
DESCOPE_TEST_LOGIN_ID=...
```

La Management Key solo pertenece al script local/backend de pruebas. Nunca se expone
en Astro, código cliente, documentación, archivos `.http` ni despliegues públicos.

## Flujo autenticado repetible

```text
Script Node
  → solicita OTP para test user con Management Key
  → verifica OTP o usa Magic Link si Email OTP está deshabilitado
  → comprueba audience y claim tu=true
  → guarda local.TEST_SESSION_JWT en requests/http-client.private.env.json
  → httpYac selecciona local y llama GET /api/v1/auth/me
```

Si alguna credencial aparece en una terminal compartida, captura o archivo, debe
revocarse en Descope antes de generar otra.
