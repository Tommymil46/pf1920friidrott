# ===========================================================
# Ledartjänst för Aktuellt träningspass – körs på hallenskog.
# Bygg från repots rot:
#   docker build -f server/Dockerfile -t pf1920-ledare .
# ===========================================================
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Användare och datakatalog skapas FÖRE VOLUME – ändringar i en
# katalog efter VOLUME-raden kastas bort av Docker.
RUN addgroup -S app && adduser -S app -G app \
 && mkdir -p /data && chown -R app:app /data /app

# Beroenden först, för bättre lagercache
COPY --chown=app:app server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Serverkod
COPY --chown=app:app server/src ./src

# Webben och startinnehållet följer med, så hallenskog kan visa sidan
# även om GitHub Pages skulle ligga nere.
COPY --chown=app:app web ./web
COPY --chown=app:app content ./content

ENV PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    CONTENT_DIR=/app/content

VOLUME ["/data"]
EXPOSE 8080
USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/status >/dev/null || exit 1

CMD ["node", "src/index.js"]
