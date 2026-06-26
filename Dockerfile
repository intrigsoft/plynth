# Plynth — single-service image. The NestJS backend serves the API (/api) and
# the built React SPA from the same origin. Railway injects $PORT at runtime.
FROM node:20-slim

WORKDIR /app

# Install workspace deps first (cached unless a package.json/lockfile changes)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

# Build shared → backend → frontend (frontend/dist is served by the backend)
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Default: in-memory JSON store (ephemeral). For persistence, mount a Railway
# volume and set PLYNTH_DB=/data/plynth-db.json.
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
