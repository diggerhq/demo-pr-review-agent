FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY README.md conversation-history.md opencomputer-dx-notes.md ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["npm", "start"]

