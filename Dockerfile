FROM node:22.22-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
ARG BUILD_COMMIT
ARG BUILD_TIME
ARG BUILD_DIRTY
ARG BUILD_SOURCE_HASH
RUN node scripts/build/writeBuildInfo.js && npm run build:react && npm prune --omit=dev

ENV RECORDS_PATH=/data/trilingual_records
EXPOSE 3010
CMD ["npm", "start"]
