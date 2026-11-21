# Conectar y verificar

Ejecuta los comandos desde `scripts/ktsu-cli` dentro de la skill. Necesitas Node 24+ y puedes usar pnpm o llamar a `node bin/ktsu.mjs`. Para la configuración, usa el origen HTTPS de la API y de la web y copia el ID del proyecto desde Integraciones.

```sh
pnpm run ktsu config set --api-url 'https://ktsu-api.vercel.app' --web-url 'https://ktsu-web.vercel.app' --project-id '<uuid del proyecto>'
pnpm run ktsu config show
```

Para OAuth, en **Integraciones → CLI** autoriza tu cuenta y el alcance. Ejecuta `pnpm run ktsu auth login` y completa Descope en el navegador de ese mismo equipo. Usa `--read-only` para solicitar solo lectura. El llavero disponible en macOS o Secret Service en Linux guarda y renueva la sesión. `pnpm run ktsu auth logout` borra la sesión local e intenta revocar ambos tokens en Descope. Para retirar inmediatamente el acceso al proyecto, revoca la concesión en Integraciones.

Para scripts o cuando la web ofrece **Credencial de proyecto**, emite un acceso CLI con el alcance requerido. Guarda el valor mostrado una vez en tu gestor de secretos. Inyecta `KTSU_TOKEN` solo en el proceso que lo usa o pásalo por un pipe privado con `--token-stdin`. No guardes tokens en `config.json`, el historial del shell, documentos compartidos ni registros.

```sh
pnpm run ktsu auth status --json
pnpm run ktsu operations list --json
pnpm run ktsu read get_project_overview --json
```

Comprueba `organizationId`, `projectId`, el nombre del proyecto y `capabilities`. `INTEGRATION_OAUTH_GRANT_REQUIRED` indica que falta la concesión vigente en Integraciones. Si la credencial no tiene permiso, confirma con el titular el alcance requerido antes de emitir otro acceso.
