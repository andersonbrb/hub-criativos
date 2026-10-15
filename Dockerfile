# Hub de Criativos no Railway: Next.js (hub/) + ffmpeg (editor) + Python/faster-whisper (montagem e transcrição local) + LaMa (remover legenda)
# + Chrome headless do Remotion (gráficos animados da edição final).
FROM node:22-bookworm-slim

# Bibliotecas que o Chrome headless do Remotion precisa no Debian, e fontes:
# Arial Black/Impact (pacote da Microsoft, do repositório contrib) são as fontes das legendas e dos gráficos;
# DejaVu fica de reserva se o download das fontes da Microsoft falhar no build.
RUN echo "deb http://deb.debian.org/debian bookworm contrib" > /etc/apt/sources.list.d/contrib.list \
  && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates fontconfig fonts-dejavu-core \
     libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 \
     libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
  && (apt-get install -y --no-install-recommends ttf-mscorefonts-installer || echo "Aviso: fontes da Microsoft indisponíveis; usando DejaVu") \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

# PyTorch (versão só CPU, bem menor) + OpenCV: "Remover legenda" com o LaMa (scripts/remover_legenda.py).
# O modelo big-lama.pt (~200 MB) é baixado no 1º uso para o volume (/app/.data/models).
RUN python3 -m venv /opt/py && /opt/py/bin/pip install --no-cache-dir faster-whisper numpy opencv-python-headless   && /opt/py/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
ENV PYTHON_BIN=/opt/py/bin/python

WORKDIR /app
COPY hub/package.json hub/package-lock.json ./
RUN npm ci
# Baixa o Chrome headless do Remotion já no build (senão o primeiro render tenta baixar com o servidor rodando).
RUN npx remotion browser ensure

COPY hub/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Mídias, arquivos do hub e modelos do Whisper ficam no volume do Railway montado em /app/.data.
# O banco (contas, memória) fica no Postgres do Railway (DATABASE_URL).
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 HF_HOME=/app/.data/hf
EXPOSE 3000
# Aplica as migrações pendentes (db/migrations, copiadas junto com hub/) antes de o servidor subir.
# Se a migração falhar, o servidor não sobe: melhor do que rodar com o banco pela metade.
CMD ["sh", "-c", "npm run db:migrar && exec npm start"]
