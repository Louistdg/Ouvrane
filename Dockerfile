FROM node:22.23.3-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts ./scripts
COPY web ./web
COPY worker ./worker
COPY drizzle ./drizzle
COPY .openai ./.openai
RUN node scripts/build.mjs
RUN npm prune --omit=dev
ENV NODE_ENV=production
COPY scripts/seed-batinova.sqlite /app/scripts/seed-batinova.sqlite
CMD ["node", "scripts/v5-start.mjs"]
