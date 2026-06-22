FROM node:alpine AS build
WORKDIR /app
ARG VITE_APP_VERSION
ARG VITE_BUILD_STAMP
ARG VITE_GIT_SHA
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_BUILD_STAMP=$VITE_BUILD_STAMP
ENV VITE_GIT_SHA=$VITE_GIT_SHA
COPY package*.json ./
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY . .
RUN npm run build

FROM archlinux:base
RUN pacman -Sy --noconfirm nodejs npm espeak-ng \
  && pacman -Scc --noconfirm
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY --from=build /app/dist ./dist
COPY server ./server
ENV PORT=8080
ENV PIPER_BIN=/opt/piper-tts/piper
ENV PIPER_MODEL=/models/piper/en_US-ryan-high.onnx
ENV PIPER_CONFIG=/models/piper/en_US-ryan-high.onnx.json
EXPOSE 8080
CMD ["node", "server/tts.mjs"]
