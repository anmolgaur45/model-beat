# Contingency image for self-hosting the frontend (Cloud Run + Cloudflare) if
# Vercel Hobby ever pauses the project. Not used by the normal Vercel deploy.
# Cutover steps: tasks/vercel-escape-runbook.md. Build needs DB access because
# ~490 pages prerender from Cloud SQL; pass DATABASE_* as build args. Runtime
# needs the same vars (story pages are SSR) via Cloud Run env / docker run -e.

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DATABASE_HOST
ARG DATABASE_PORT=5432
ARG DATABASE_NAME=ainews
ARG DATABASE_USER=ainews_app
ARG DATABASE_PASSWORD
ARG NEXT_PUBLIC_URL=https://themodelbeat.com
ENV DATABASE_HOST=$DATABASE_HOST \
    DATABASE_PORT=$DATABASE_PORT \
    DATABASE_NAME=$DATABASE_NAME \
    DATABASE_USER=$DATABASE_USER \
    DATABASE_PASSWORD=$DATABASE_PASSWORD \
    NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL
RUN pnpm build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
