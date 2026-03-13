FROM mcr.microsoft.com/playwright:v1.54.2-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3838

EXPOSE 3838

CMD ["node", "app-server.js", "--no-open"]
