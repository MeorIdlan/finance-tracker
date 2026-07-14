FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY shared shared
COPY server server
RUN npm run build --workspace shared && npm run build --workspace server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
