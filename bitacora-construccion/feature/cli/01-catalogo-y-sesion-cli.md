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
| e2e `integrations.e2e-spec` en Nest | Pendiente de resultado en esta sesión. |

## Pendiente

- Commit de `feature/ia-contexto` en Nest y Nuxt, y su paso a `deploy/vercel`. La web publicada sigue mostrando `npm install -g ./packages/ktsu-cli`.
- Descope: API Resource e Inbound App de la CLI y las variables `CLI_OAUTH_*` en Vercel (plan 03, «Vincular Descope a Nest»).
- Migraciones de propuestas y concesiones OAuth en Neon antes de publicar la API.
- Prueba de producción con **Personal · Prueba**: `auth login`, `auth status`, `read get_project_overview` y una propuesta revisada en la web.
