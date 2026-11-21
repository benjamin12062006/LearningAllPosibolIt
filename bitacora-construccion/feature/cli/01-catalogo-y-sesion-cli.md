# 01 — Catálogo, propuestas y sesión de la CLI

Fecha de creación: 2026-11-21  
Última actualización: 2026-11-21  
Estado: En curso  
Relacionada con: [plan de ejecución](../../../docs/plans/feature/cli/03-plan-ejecucion-cli.md), [plan de catálogo y distribución](../../../docs/plans/feature/cli/02-plan-catalogo-completo-y-distribucion-cli.md) y [fuentes](../../../docs/fonts/feature/cli/01-fuentes-cli-ktsu.md).  
Revisión de partida: `feature/ia-contexto` desde `55a04a1`, sin commits propios todavía.

La CLI comparte los casos de uso del agente y verifica los permisos desde la pasarela de Nest. El OAuth de terminal usa un cliente público con callback de loopback y una concesión separada por proyecto. [Descope](https://docs.descope.com/identity-federation/inbound-apps/developing-apis) · [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)

## La CLI dentro de la skill (paso 4 del plan 03)

- **Una sola copia.** El ejecutable vive solo en [`skills/ktsu-cli/scripts/ktsu-cli`](../../../skills/ktsu-cli/scripts/ktsu-cli). Se retiró `packages/ktsu-cli`, que era una copia idéntica sin seguimiento y podía desviarse. La distribución con `npm install -g` y `npm pack` del plan 02 (punto 5) queda sustituida: no se instala nada, se ejecuta `pnpm run ktsu` dentro de la skill.
- **Estructura de la skill.** [`SKILL.md`](../../../skills/ktsu-cli/SKILL.md) dice cuándo usarla, el recorrido en siete pasos (destino → acceso → comprobación → descubrimiento → lectura → propuesta → informe) y las reglas de secretos y confirmación humana. Los detalles van en `references/`: [`comandos.md`](../../../skills/ktsu-cli/references/comandos.md) (nueva: todos los comandos, opciones, variables, prioridad del perfil, descargas y errores, contrastados con `bin/ktsu.mjs`), `acceso.md`, `operaciones.md` y `feed.md`.
- **Publicación en la web.** Nest sirve los archivos exactos en `GET P/integrations/cli-skill` ([`cli-skill.ts`](../../../src/integrations/cli-skill.ts)); el Dockerfile copia `skills/ktsu-cli`. La web los muestra en **Integraciones → CLI → Ver skill de KTSU CLI** con el árbol `UTree` de Nuxt UI y el contenido de cada archivo, sin descargas. «Copiar archivo» copia uno; «Copiar skill completa» copia instrucciones y un JSON `{ name, files, context }`. Las instrucciones dicen ahora dónde crear la carpeta (`~/.claude/skills/ktsu-cli` o `~/.codex/skills/ktsu-cli`), que el contenido se escribe literal y cómo comprobarla con `pnpm run ktsu --help`.
- **Prueba de cobertura de la lista.** La lista de archivos que sirve Nest es explícita para no publicar nada por accidente. El e2e compara ahora esa lista con todos los archivos de la carpeta, en vez de contar nueve: si alguien añade un archivo a la skill sin publicarlo, falla.

## Comprobaciones

| Comprobación | Resultado |
| --- | --- |
| `pnpm run ktsu config show --json` y `auth status --json` dentro de la skill con un perfil temporal | stdout solo con JSON; pnpm escribe su línea `$ node …` en stderr y conserva el código de salida 1. |
| Ida y vuelta: archivos reales → `skillClipboard` → JSON pegado → carpeta nueva → `diff -r` contra el repositorio → `pnpm run ktsu --help` en la copia | Idéntico y ejecutable (prueba temporal de Vitest, retirada después). |
| Vitest `test/unit/integrations` y ESLint en la web | 6/6 pruebas, sin avisos. |
| Suites de features de Nest (`--runInBand`), incluida `integrations.e2e-spec` | 46 suites y 580 pruebas aprobadas, 2 omitidas. |
| `node --test test/ktsu-cli-oauth.test.mjs` | 1/1. |
| Nuxt: `pnpm test`, `typecheck` y `lint` | 199 pruebas; typecheck sin errores; lint con 2 avisos previos de `vue/require-default-prop`. |
| FastAPI: `pytest`, `ruff check`, `ruff format --check`, `mypy` y `lint-imports` | Aprobados. |

## Publicación (2026-11-21)

- Commits en `feature/ia-contexto`: Nest `3896d0f`, Nuxt `ff8f62b`, FastAPI `2c840a1`. Nest y FastAPI pasaron a `deploy/vercel` por fast-forward. En Nuxt, `deploy/vercel` tenía `7919a40`, cuyo contenido ya estaba en la rama de la feature; la unión `af84753` deja el árbol idéntico a `ff8f62b`.
- Neon: `migrate status` mostró solo `add_ai_proposal_failure` y `add_cli_oauth_grants` pendientes; `migrate deploy` las aplicó, `status` dice «Database schema is up to date!» y `migrate diff` contra `schema.prisma` sale vacío. Ambas solo amplían restricciones y añaden una columna opcional.
- Sin `CLI_OAUTH_*`, `cliOAuthConfigFrom` devuelve `null`: Nest arranca con el OAuth de la CLI desactivado y la credencial de proyecto sigue disponible.

## Descope y OAuth de la CLI (2026-11-21)

- Recurso **KTSU CLI** (`RS3MR3SNBSl9cWkA3hMHDyweobfpp`), tipo API, audiencia `https://ktsu-api.vercel.app/api/v1/integrations`, scopes `ktsu:cli:read` y `ktsu:cli:prepare`.
- Inbound App **KTSU CLI** (`TPA3MR3Ux65X3knuKi4ixCPapTIo7C`): cliente público (PKCE obligatorio), Authorization Code, callback `http://127.0.0.1/callback`, audiencia permitida la del recurso y los mismos dos permission scopes. El scope por defecto `full_access` se sustituyó.
- Sin regla de Access Policy: crear la primera activa la aplicación de políticas con «bloquear todo» por defecto y cortaría el OAuth del MCP, que no tiene regla propia. La regla por defecto sigue permitiendo cualquier petición.
- `ktsu-api` tiene `CLI_OAUTH_CLIENT_ID`, `CLI_OAUTH_ISSUER` (`https://api.descope.com/v1/apps/P3JZVKos0A8JS0nkys6IhYAySQdI`) y `CLI_OAUTH_RESOURCE_URL`. Nest se redesplegó (`ktsu-kg88dm11p…`) y `ktsu-mcp` se apuntó a él y se redesplegó (`ktsu-bno2mzcfx…`).
- Comprobado: `GET /api/v1/integrations/oauth` 200 con cliente, issuer, recurso y scopes; discovery con el mismo issuer, endpoints en `api.descope.com` y S256. `authorize` con puerto efímero en `127.0.0.1` redirige al flujo `inbound-apps-user-consent` con ambos scopes; antes de añadirlos a la app devolvía `invalid_scope`. La CLI de la skill contra producción responde `INTEGRATION_CREDENTIAL_INVALID` a una credencial ficticia.

## Pendiente

- Prueba con sesión real en **Personal · Prueba**: autorizar la CLI en Integraciones, `pnpm run ktsu auth login`, `auth status`, `read get_project_overview` y una propuesta revisada en la web.
