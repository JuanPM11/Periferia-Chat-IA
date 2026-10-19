# Imagen única: backend (Node) que sirve también el front ya construido.
FROM node:20-slim

WORKDIR /app

# Dependencias (con scripts de postinstall habilitados para esbuild/vite)
COPY package.json package-lock.json* ./
RUN npm install

# Código y fixtures
COPY . .

# Construye el front a web/dist
RUN npm run build:web

ENV PORT=8787
EXPOSE 8787

# El servidor sirve el front desde web/dist y expone /api/*
CMD ["npx", "tsx", "src/server.ts"]
