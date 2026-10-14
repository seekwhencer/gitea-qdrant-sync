FROM node:22-alpine

#
WORKDIR /app

#
COPY package*.json ./
RUN npm install

RUN npm install -g npm-check-updates

#
COPY index.js ./
COPY config.json ./
COPY server ./server

#
COPY frontend ./frontend
RUN cd frontend && npm install && npm run build

#
EXPOSE 3000

#
CMD ["node", "index.js"]
