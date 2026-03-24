FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src ./src
COPY test ./test

EXPOSE 4000
CMD ["npm", "start"]
