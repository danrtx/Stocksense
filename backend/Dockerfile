# API de StockSense (NestJS). Imagen de producción en dos etapas.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
# El seed aplica migraciones y crea el primer administrador si no existe.
CMD ["sh", "-c", "node dist/database/seeds/seed.js && node dist/main.js"]
