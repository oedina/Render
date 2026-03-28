# 🚂 RailAlert — Global Railway Accident Tracker

An interactive world map for tracking and sharing railway accidents worldwide, inspired by globalmap.news.

## Features

- 🗺️ **Interactive dark-themed world map** with incident pins colored by severity
- 🔍 **Search & filter** by severity, type (derailment/collision), country
- 📊 **Live stats** — total incidents, casualties, injuries
- ➕ **Submit incidents** via a report form
- 📌 **Detail panel** slides up when you click a marker
- 🗄️ **SQLite backend** via Express — seeded with 15 real historical accidents
- 🌐 **Fully self-hosted** — no external API keys needed

---

## Quick Start (Local)

### 1. Install backend dependencies
```bash
cd backend
npm install
```

### 2. Start the server
```bash
npm start
```

The server will:
- Start on **http://localhost:3001**
- Seed the database with real accident data on first run
- Serve the frontend from `frontend/public/`

### 3. Open in browser
Visit **http://localhost:3001**

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/accidents` | List all accidents (filterable) |
| GET | `/api/accidents/:id` | Get single accident |
| POST | `/api/accidents` | Submit new accident |
| GET | `/api/stats` | Aggregate statistics |

### Query parameters for GET /api/accidents
- `severity` — minor, moderate, severe, catastrophic
- `type` — derailment, collision, fire, bridge_failure, other
- `country` — partial match
- `year` — e.g. 2023
- `search` — full-text search on title, description, location

### POST /api/accidents body
```json
{
  "title": "XYZ Express Derailment",
  "description": "Train derailed at...",
  "location": "City, Region",
  "country": "Country",
  "lat": 40.7128,
  "lng": -74.0060,
  "date": "2024-01-15",
  "severity": "severe",
  "type": "derailment",
  "casualties": 3,
  "injuries": 25,
  "source_url": "https://..."
}
```

---

## Deployment Options

### Option A: Railway.app (Recommended, free tier)
1. Push to GitHub
2. Create project at https://railway.app
3. Connect repo → select `backend/` as root
4. Set start command: `node server.js`
5. Deploy — Railway auto-assigns a URL

### Option B: Render.com (Free tier)
1. Push to GitHub
2. New Web Service at https://render.com
3. Root directory: `backend`
4. Build: `npm install`
5. Start: `node server.js`

### Option C: VPS (DigitalOcean / Hetzner)
```bash
# On server:
git clone <your-repo>
cd railway-accidents/backend
npm install
# Install PM2 for process management
npm install -g pm2
pm2 start server.js --name railalert
pm2 save
```

Add Nginx reverse proxy pointing to port 3001.

### Option D: Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY backend/ ./backend/
COPY frontend/ ./frontend/
WORKDIR /app/backend
RUN npm install
EXPOSE 3001
CMD ["node", "server.js"]
```

---

## Custom Domain
After deploying, point your domain's A record to your server IP, then:
- Add SSL via Let's Encrypt: `certbot --nginx`
- Update Nginx config to proxy to port 3001

---

## Extending the Project

### Add authentication for moderation
```bash
npm install jsonwebtoken bcrypt
```

### Add image uploads for incident photos
```bash
npm install multer
```

### Add email notifications for new reports
```bash
npm install nodemailer
```

### Add a scraper to auto-import news
Consider using the [GDELT Project API](https://www.gdeltproject.org/) for automated railway news.

---

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS + Leaflet.js (OpenStreetMap)
- **Backend**: Node.js + Express
- **Database**: SQLite via better-sqlite3
- **Map tiles**: CartoDB Dark Matter (free, no API key)
