// Registro de un Resource en el proyecto Descope indicado en .env.
import { existsSync } from 'node:fs';

try {
  await main();
} catch (error) {
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const resource = process.env.MCP_OAUTH_RESOURCE_URL?.trim();
  const url = resource && URL.parse(resource);
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.pathname !== '/mcp' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== resource
  ) {
    throw new Error(
      'Define MCP_OAUTH_RESOURCE_URL con la URL HTTPS pública exacta /mcp.',
    );
  }
  const template = process.env.DESCOPE_MCP_REGISTRATION_TEMPLATE_ID?.trim();
  if (!template)
    throw new Error(
      'Define DESCOPE_MCP_REGISTRATION_TEMPLATE_ID con el template de consentimiento.',
    );
  const payload = {
    name: 'KTSU MCP',
    description:
      'Acceso de usuario a las herramientas KTSU del proyecto autorizado.',
    type: 'mcp',
    uri: resource,
    userAccess: 'allow',
    clientAccess: 'deny',
    scopes: {
      permissionsScopes: [
        {
          name: 'ktsu:mcp:read',
          description: 'Leer el proyecto autorizado de KTSU',
          optional: false,
        },
        {
          name: 'ktsu:mcp:prepare',
          description: 'Preparar propuestas para aprobación en KTSU',
          optional: true,
        },
      ],
    },
    dynamicRegistrationSettings: {
      useTemplate: true,
      dynamicRegistrationTemplateId: template,
      dynamicRegistration: { enabled: true },
    },
  };

  if (!process.argv.slice(2).includes('--apply')) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const project = process.env.DESCOPE_PROJECT_ID?.trim();
  const key = process.env.DESCOPE_MANAGEMENT_KEY?.trim();
  if (!project || !key)
    throw new Error('Faltan credenciales de gestión del proyecto Descope.');
  const headers = {
    Authorization: `Bearer ${project}:${key}`,
    'Content-Type': 'application/json',
  };
  const lookup = await send(
    '/v1/mgmt/resource/load/uri?' + new URLSearchParams({ uri: resource }),
    { headers },
  );
  if (lookup.ok) {
    const existing = (await lookup.json()).resource;
    if (existing?.type !== 'mcp' || existing?.uri !== resource)
      throw new Error('Ya existe un Resource incompatible.');
    console.log(
      'El Resource ya existe. Revisa sus scopes, registro y consentimiento en Descope.',
    );
    return;
  }
  if (lookup.status !== 404)
    throw new Error(
      `Descope rechazó la consulta del Resource (HTTP ${lookup.status}).`,
    );
  const created = await send('/v1/mgmt/resource/create', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!created.ok)
    throw new Error(
      `Descope rechazó el alta del Resource (HTTP ${created.status}).`,
    );
  console.log(
    'Resource creado. Copia el issuer de Discovery desde Descope al entorno de ambos backends.',
  );
}

async function send(path, options) {
  try {
    return await fetch(new URL(path, 'https://api.descope.com'), {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('Descope Management API no respondió.');
  }
}
