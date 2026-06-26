# --- Build stage ----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Install all deps (incl. dev) for the TypeScript build.
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies for a lean runtime node_modules.
RUN npm prune --omit=dev

# --- Runtime stage ---------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Run as the unprivileged user that the node image already provides.
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
