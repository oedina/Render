FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production
COPY backend/ ./backend/
COPY frontend/ ./frontend/
WORKDIR /app/backend
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "server.js"]
