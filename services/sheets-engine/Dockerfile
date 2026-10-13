FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY *.mjs ./
USER node
EXPOSE 8010
CMD ["node", "server.mjs"]
