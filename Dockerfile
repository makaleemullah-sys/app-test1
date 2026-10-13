FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
# Mount a persistent volume here so accounts and logs survive restarts.
ENV DB_FILE=/data/lunaria.db
ENV TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
