# Image de production de l'app Djomy pour Shopify.

FROM node:22-slim AS build
# Prisma a besoin d'OpenSSL pour choisir son moteur.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
# Le CLI Prisma (dépendance de développement) reste nécessaire au démarrage
# pour appliquer les migrations : on garde donc node_modules tel quel.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
# Applique les migrations en attente, puis démarre le serveur.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
