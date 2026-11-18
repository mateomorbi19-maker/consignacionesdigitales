# Landing de consignación de Surcars: servidor Node sin dependencias (no hace falta npm install).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Solo lo necesario para servir la landing: las pruebas y los envíos no van en la imagen.
COPY package.json server.js aviso-email.js ./
COPY public ./public

# Los envíos se guardan en /app/leads. Montá un volumen ahí para no perderlos entre despliegues.
RUN mkdir -p /app/leads && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
