# syntax=docker/dockerfile:1
#
# Imagen de la API Nest (deploys, plan 06, D12). Dos destinos:
#
#   docker build --target runtime -t ktsu-api .       # la API (por defecto)
#   docker build --target migrate -t ktsu-migrate .   # Prisma CLI y migraciones
#
# Las etapas van en el orden en que se leen: dependencias → compilación →
# migración → ejecución. Ninguna necesita la base de datos ni secretos.

# Bases fijadas por versión y digest (deploys, fuentes 07, F5). Node 24.19.0
# cumple `engines` del package.json; bookworm trae glibc, que es lo probado.
ARG NODE_IMAGE=node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
ARG CLOUD_SQL_PROXY_IMAGE=gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.28.0@sha256:e0cbea7b63455c1635d354ef456696d019dd02a5db47bf1994e849823e71ae89

FROM ${CLOUD_SQL_PROXY_IMAGE} AS cloud-sql-proxy


# --- Base común: Node y el pnpm que fija `packageManager` -------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
# Sin esto, corepack pregunta antes de descargar pnpm y el build se queda parado.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app


# --- Dependencias completas: lo que hace falta para compilar y migrar -------
FROM base AS dependencies
# Prisma CLI necesita OpenSSL y Cloud SQL Auth Proxy valida TLS con las CA del sistema.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
# Solo los manifiestos: esta capa se reutiliza mientras no cambie el lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
# Deja descargado el motor de migraciones de esta plataforma. Después se migra
# con el usuario `node`, que no puede escribir en `node_modules`.
RUN pnpm exec prisma version


# --- Compilación: genera el cliente de Prisma y deja `dist/` ----------------
FROM dependencies AS build
COPY prisma ./prisma
COPY prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
# `prebuild` ejecuta `prisma generate`; no se conecta a ninguna base.
RUN pnpm build


# --- Dependencias de ejecución: sin Prisma CLI, Jest ni el compilador -------
FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod


# --- Migración: Prisma CLI, el esquema y el SQL de las migraciones ----------
# Va en su propia imagen para que la API no lleve herramientas que pueden
# cambiar el esquema (plan 06, D6). La usa un job, no un servicio.
# Parte de `dependencies`: ya tiene Prisma CLI y OpenSSL.
FROM dependencies AS migrate
ENV NODE_ENV=production
COPY --from=cloud-sql-proxy /cloud-sql-proxy /usr/local/bin/cloud-sql-proxy
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/deploy ./scripts/deploy
USER node
ENTRYPOINT ["node", "scripts/deploy/migrate.mjs"]


# --- Ejecución: la API y sus workers, en un solo proceso (plan 06, D3) ------
FROM base AS runtime
ENV NODE_ENV=production
# En el contenedor se escucha en todas las interfaces (plan 06, D8).
ENV HOST=0.0.0.0
ENV PORT=8080
# Archivos locales cuando no hay `ARTIFACT_BUCKET`. La carpeta es del usuario
# `node`: un volumen montado aquí hereda ese dueño.
ENV CATALOG_IMPORT_ROOT=/data/catalog-import
RUN mkdir -p /data/catalog-import && chown -R node:node /data
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY skills/ktsu-cli ./skills/ktsu-cli
COPY skills/ktsu-mcp ./skills/ktsu-mcp
# `"type": "module"` está en el package.json: sin él, Node no carga `dist/`.
COPY package.json ./
USER node
EXPOSE 8080
# Forma exec: Node es el proceso 1 y recibe el SIGTERM del orquestador.
CMD ["node", "dist/main.js"]
