FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev
# Gemini CLI is run on host via proxy; do not install inside container.

COPY . .

ENV RECORDS_PATH=/data/trilingual_records
EXPOSE 3010
CMD ["npm", "start"]
