FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /worker
COPY ffmpeg-worker.mjs ./ffmpeg-worker.mjs

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "ffmpeg-worker.mjs"]
