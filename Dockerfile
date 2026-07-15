FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# Persist the SQLite database on a mounted disk
ENV DB_FILE=/data/crm.sqlite
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
