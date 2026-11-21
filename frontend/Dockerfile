# Frontend de StockSense: se compila con Vite y se sirve con Nginx.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# nginx reemplaza ${PORT} y ${BACKEND_URL} al arrancar; solo esas dos, el resto de $variables quedan igual.
ENV PORT=80 BACKEND_URL=http://backend:3000 NGINX_ENVSUBST_FILTER=^(PORT|BACKEND_URL)$
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
