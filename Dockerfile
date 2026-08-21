FROM node:20-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /data
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
