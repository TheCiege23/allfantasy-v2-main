# Railway's Nixpacks builder compiles this app with a Nix-packaged Node rather
# than the official binary, and the bundle it produces has lost the root layout:
# app-build-manifest.json lists no CSS for /layout, app/globals.css never enters
# the module graph, and every App Router route is served with no <!DOCTYPE html>,
# <html>, <head> or <body>. The RSC payload has no html or body entries either,
# so the layout is missing from the tree rather than rendering badly. The page
# paints for an instant and then hydration tears the document down.
#
# The same commit, built with the same command — railway-clean-next-build,
# the Tailwind prebuild, the loader-cache purge, then next build — is correct
# when it runs off Railway: /layout carries both stylesheets, one chunk holds
# the 775KB of Tailwind, and the document has its shell. That rules out the
# application code and the build scripts together, which leaves the builder
# image. This pins it to the official Node 20.
FROM node:20-bookworm-slim

# openssl is required by Prisma's engines; ca-certificates for TLS during build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install from the lockfile first so this layer caches independently of source
# changes. prisma/ and scripts/ are copied ahead of npm ci because postinstall
# runs prisma generate and patches Next's pages-manifest plugin.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

COPY . .

RUN npx prisma generate && npm run build:railway

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start:railway"]
