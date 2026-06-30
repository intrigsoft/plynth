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

# DioscHub embed config for the frontend. Vite inlines `import.meta.env.VITE_*`
# at BUILD time, so these must be present before `npm run build`. Railway passes
# service variables to the Docker build as args — declare them here so the SPA
# bundle is baked with the hub URL, embed key and assistant id.
ARG VITE_DIOSC_HUB_URL
ARG VITE_DIOSC_EMBED_KEY
ARG VITE_DIOSC_ASSISTANT_ID
ENV VITE_DIOSC_HUB_URL=$VITE_DIOSC_HUB_URL \
    VITE_DIOSC_EMBED_KEY=$VITE_DIOSC_EMBED_KEY \
    VITE_DIOSC_ASSISTANT_ID=$VITE_DIOSC_ASSISTANT_ID

# Build shared → backend → frontend (frontend/dist is served by the backend)
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Default: in-memory JSON store (ephemeral). For persistence, mount a Railway
# volume and set PLYNTH_DB=/data/plynth-db.json.
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
