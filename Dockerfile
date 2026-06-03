FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache font-noto ttf-dejavu fontconfig

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
