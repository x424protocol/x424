# Production-shaped x424 verifier image (P2-01).
# Non-root, minimal, configuration-validated at startup.
# Build from repository root:
#   docker build -f deploy/verifier/Dockerfile -t x424-verifier:0.1.0 .

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY schemas ./schemas
COPY conformance ./conformance
COPY openapi ./openapi
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 10001 --create-home x424
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/conformance ./conformance
COPY --from=build /app/openapi ./openapi
COPY deploy/verifier/entrypoint.mjs ./entrypoint.mjs
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "entrypoint.mjs"]
