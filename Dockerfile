FROM node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Writable only where tokens are persisted; app code stays root-owned (read-only for node)
RUN mkdir -p /app/data && chown node:node /app/data

ARG PORT=4000
ENV PORT=${PORT}
EXPOSE ${PORT}

USER node

CMD ["node", "src/server.js"]
