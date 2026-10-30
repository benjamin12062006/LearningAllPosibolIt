# 01 — HTTP Client de WebStorm y compatibilidad con httpYac

Fecha de creación: 2026-10-26
Tipo de fuente: Documentación oficial y código local
Origen: JetBrains WebStorm 2026.2; httpYac 6.16.7 instalado
Fecha de consulta: 2026-10-26
Relacionada con: [Implementación HTTP](../../../bitacora-construccion/http/01-entorno-privado-y-peticiones-webstorm.md)

## Necesidad de consulta

Unificar las peticiones de `requests/` para ejecutarlas desde WebStorm y desde
los comandos existentes. El usuario confirmó que `{{TEST_SESSION_JWT}}` funciona
en `auth.http` y pidió guardar la sesión en el JSON privado de esa misma carpeta.
Se eligió documentación oficial como fuente principal por petición expresa; no
se usaron cursos ni reconstrucciones para atribuirles estas APIs del cliente.

## Evidencia y localización verificable

### F1 — Variables, ámbitos y secretos

[HTTP Client variables](https://www.jetbrains.com/help/webstorm/http-client-variables.html),
WebStorm 2026.2: apartados «Use a variable inside the request», «Environment
variables», «Define environment variables» y «Manage multiple environment files».

La sintaxis es `{{variable}}`. `http-client.env.json` contiene configuración
compartible; `http-client.private.env.json` contiene secretos. Ambos agrupan valores
por entorno y el IDE permite seleccionarlo en **Run with**. Para commits desde
terminal, JetBrains indica añadir expresamente el archivo privado a `.gitignore`.
El cliente busca el entorno en la carpeta de la petición y después en sus padres.

La documentación actual incorpora `client.variables` como acceso unificado y
conserva `client.global` y `request.environment`. Desde 2024.2, los nombres se
interpretan como JSONPath. Los nombres simples actuales no necesitan cambios.
La página presenta descripciones contradictorias sobre prioridad público/privado;
esta adaptación evita claves duplicadas entre ambos archivos.

### F2 — Nombres y multipart

[Exploring the HTTP request syntax](https://www.jetbrains.com/help/webstorm/exploring-http-syntax.html),
WebStorm 2026.2: «Set names for HTTP requests», «Compose several requests in a
single file» y «Use multipart/form-data content type».

`# @name` permite nombrar peticiones y `###` las separa. El multipart con boundary
y CSV en línea que ya tiene el proyecto sigue siendo válido. La página también
documenta temporizadores y cuerpos desde archivos; no hacen falta para este cambio.

### F3 — Scripts y estado entre peticiones

[HTTP Client](https://www.jetbrains.com/help/webstorm/http-client-in-product-code-editor.html),
WebStorm 2026.2: «Use response handler and pre-request scripts», «Insert response
handler scripts» y «Execute multiple requests sequentially».

Los handlers usan `> {% ... %}` y acceden a `response.status` y `response.body`.
`client.assert` comprueba condiciones; `client.global.set` guarda valores reutilizables
por otras peticiones hasta cerrar el IDE. Permite capturar los IDs devueltos por
crear proyecto y aceptar importación. Este estado no constituye persistencia en disco.

### F4 — Reutilización con httpYac

[Environments](https://httpyac.github.io/guide/environments.html), apartado
«Intellij Environment»; [Scripting](https://httpyac.github.io/guide/scripting.html),
apartado «Intellij Script»; [httpyac CLI](https://httpyac.github.io/guide/installation_cli.html),
apartado «Arguments».

httpYac admite los dos JSON de entorno junto al `.http`, selección con `--env`
y scripts compatibles con IntelliJ, incluidos `client.global.set`. Su documentación
advierte que los motores JavaScript difieren. Por eso se usa ese subconjunto
compartido y se verifica con la versión instalada; no se asume paridad completa.

## Adaptación y límites

La propuesta propia es usar `local.apiUrl` en el JSON público y
`local.TEST_SESSION_JWT` en el privado. El generador conserva las demás claves y
entornos existentes, restringe permisos y no imprime el JWT. El `.env` del backend
sigue conteniendo las credenciales de Descope que necesita el script.

Se conservan `client.global` y nombres simples por compatibilidad comprobable con
httpYac. No se incorporan `client.variables`, OAuth automático, temporizadores ni
otras APIs nuevas sin necesidad. `projectId`, `jobId` y `snapshotId` no tienen
marcadores en el entorno público que puedan ocultar los IDs capturados.

La documentación demuestra las capacidades disponibles; la comprobación concreta
y cualquier ejecución pendiente se registran en la entrada relacionada.
