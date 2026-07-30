# syntax=docker/dockerfile:1

# =================================================================================================
# Build Stage
# =================================================================================================
FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build


# =================================================================================================
# Runtime Stage
# =================================================================================================
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

ENV NAVIDROME_CONFIG_PATH=/config/settings.json
# Owned by `node` (the USER below) so anything the runtime writes beside the
# settings file works — notably navidrome-web.log, if a derived image adds mpv.
# A Docker-created anonymous volume inherits this ownership; a bind mount keeps
# the host's, which is the operator's to get right.
RUN mkdir -p /config && chown node:node /config
VOLUME ["/config"]

# Container-shaped defaults for the env-var config fallback: this image exists
# for the HTTP-transport use case, and a container must bind 0.0.0.0 for its
# published port to work. Both are only fallback values — a mounted
# /config/settings.json always wins, and `-e MCP_TRANSPORT=stdio` overrides.
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_EXPOSE=true

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "require('node:http').get('http://127.0.0.1:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

USER node
CMD ["node", "dist/index.js"]
