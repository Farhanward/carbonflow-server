FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose curl jq util-linux

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

EXPOSE 8088
CMD ["node", "server.js"]
