FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

USER node
EXPOSE 3010
CMD ["node", "server.js"]
