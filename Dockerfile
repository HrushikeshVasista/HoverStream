FROM node:latest

WORKDIR /app

COPY . .

RUN npm install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000 3001 9229

CMD ["/entrypoint.sh"]