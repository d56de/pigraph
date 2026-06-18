# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared/ shared/
COPY web/ web/
RUN npm run build -w web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_DIST=./web/dist
ENV HOST=0.0.0.0
COPY package*.json ./
COPY shared/ shared/
COPY server/ server/
COPY --from=build /app/web/dist web/dist
RUN npm ci --omit=dev
EXPOSE 5641
CMD ["npx", "tsx", "server/src/index.ts"]
