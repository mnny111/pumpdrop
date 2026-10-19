FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
COPY vendor ./vendor
RUN npm ci --omit=dev --ignore-scripts
COPY backend ./backend
COPY dist ./dist
COPY server.mjs ./server.mjs
CMD ["node", "server.mjs"]
