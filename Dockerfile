FROM node:20-slim

WORKDIR /app

# better-sqlite3 빌드에 필요한 도구
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# 데이터 영속 경로
ENV DATA_DIR=/data
VOLUME ["/data"]

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
