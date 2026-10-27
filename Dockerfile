# TikTok Signature Server
FROM node:20-slim

# Install Chromium and dependencies.
# tini runs as PID 1 and reaps Chromium's exited child processes, which Node
# does not do — without it zombie renderers pile up as identities rotate.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    curl \
    tini \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Use the system Chromium. These must be set BEFORE `npm ci`, otherwise
# Puppeteer's postinstall downloads its own Chrome into the image as well.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production \
    PORT=8080

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --omit=dev && npm cache clean --force

# Copy application files
COPY server.mjs xgnarly.mjs benchmark.mjs ./
COPY lib/ ./lib/
COPY javascript/ ./javascript/

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
