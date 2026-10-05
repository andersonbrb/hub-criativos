# Hub de Criativos no Railway: Next.js (hub/) + ffmpeg (editor) + Python/faster-whisper (montagem e transcrição local).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir faster-whisper numpy
ENV PYTHON_BIN=/opt/py/bin/python

WORKDIR /app
COPY hub/package.json hub/package-lock.json ./
RUN npm ci

COPY hub/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Banco, mídias e modelos do Whisper ficam no volume do Railway montado em /app/.data.
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 HF_HOME=/app/.data/hf
EXPOSE 3000
CMD ["npm", "start"]
