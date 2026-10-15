# Build from the repository root: docker build -f packages/api/Dockerfile .
FROM node:22-alpine AS builder
WORKDIR /workspace
RUN npm install --global pnpm@10.18.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/api ./packages/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tzmeet/api... build
RUN pnpm --filter @tzmeet/api deploy --prod --legacy /opt/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /opt/api ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/node.js"]
