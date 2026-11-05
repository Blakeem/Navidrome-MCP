# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build


FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

ENV NAVIDROME_CONFIG_PATH=/config/settings.json
# The `node` user writes beside the settings file, such as navidrome-web.log in an image with mpv.
# A Docker-created volume inherits this ownership. A bind mount keeps the host's ownership.
RUN mkdir -p /config && chown node:node /config
VOLUME ["/config"]

# Env-fallback defaults, since this image serves the HTTP transport and a published port needs a
# 0.0.0.0 bind. A mounted /config/settings.json wins over both.
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
