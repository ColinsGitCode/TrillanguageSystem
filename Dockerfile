FROM node:22.22-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:react && npm prune --omit=dev

ENV RECORDS_PATH=/data/trilingual_records
EXPOSE 3010
CMD ["npm", "start"]
