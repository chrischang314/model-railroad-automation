FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV SESSION_DATA_DIR=/app/data/sessions

COPY package.json ./
COPY src ./src
COPY public ./public

VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "src/server.js"]
