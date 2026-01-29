FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV RECORDS_PATH=/data/trilingual_records
EXPOSE 3010
CMD ["npm", "start"]
