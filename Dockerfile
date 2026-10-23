FROM node:22.23.4-trixie-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22.23.4-trixie-slim

# Strip the package managers from the runtime image (not needed to run; their bundled deps carry CVEs)
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

COPY app.js cart.js config.js csrf.js db.js mail.js ./
COPY views ./views
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /app/public/uploads/products \
    && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "app.js"]
