# The proxy has no npm dependencies at all — node:sqlite and WebSocket-free fetch are
# built into Node 22 — so this only needs a runtime and the source.
FROM node:22-slim

WORKDIR /app
COPY package.json ./
# tsx is the only thing needed to run TypeScript directly; nothing else is installed.
RUN npm install --no-audit --no-fund --omit=dev tsx@^4.19.0

COPY shared ./shared
COPY place-proxy ./place-proxy

ENV PORT=8787
ENV CACHE_PATH=/data/places.sqlite
VOLUME /data
EXPOSE 8787

# Identify the deployment properly: Overpass and Photon both ask for it, and an
# anonymous client is the first one blocked when someone else misbehaves.
ENV OSM_USER_AGENT="hyperlocal/0.1 (private place notes)"

CMD ["npx", "tsx", "place-proxy/server.ts"]
