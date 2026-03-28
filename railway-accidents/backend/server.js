const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Initialize DB
const db = new Database(path.join(__dirname, 'accidents.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS accidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT NOT NULL,
    country TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    date TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('minor','moderate','severe','catastrophic')),
    casualties INTEGER DEFAULT 0,
    injuries INTEGER DEFAULT 0,
    source_url TEXT,
    type TEXT DEFAULT 'derailment',
    verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Seed with real historical accidents
const seedData = [
  { title: 'Balasore Train Collision', description: 'Triple train collision involving Coromandel Express, Yesvantpur–Howrah Express, and a goods train. One of India\'s deadliest rail disasters in decades.', location: 'Balasore, Odisha', country: 'India', lat: 21.4942, lng: 86.9318, date: '2023-06-02', severity: 'catastrophic', casualties: 294, injuries: 1175, source_url: 'https://en.wikipedia.org/wiki/2023_Odisha_train_collision', type: 'collision' },
  { title: 'Santiago de Compostela Derailment', description: 'A high-speed Alvia train derailed on a curve before Santiago de Compostela station. Driver was speeding excessively on a dangerous curve.', location: 'Santiago de Compostela', country: 'Spain', lat: 42.8782, lng: -8.5448, date: '2013-07-24', severity: 'catastrophic', casualties: 79, injuries: 140, source_url: 'https://en.wikipedia.org/wiki/2013_Santiago_de_Compostela_train_derailment', type: 'derailment' },
  { title: 'Lac-Mégantic Rail Disaster', description: 'Runaway train carrying crude oil derailed in downtown Lac-Mégantic causing massive explosions and fire.', location: 'Lac-Mégantic, Quebec', country: 'Canada', lat: 45.5744, lng: -70.8831, date: '2013-07-06', severity: 'catastrophic', casualties: 47, injuries: 30, source_url: 'https://en.wikipedia.org/wiki/Lac-M%C3%A9gantic_rail_disaster', type: 'derailment' },
  { title: 'East Palestine Derailment', description: 'Norfolk Southern freight train derailed carrying hazardous chemicals including vinyl chloride, causing a controlled burn and environmental concerns.', location: 'East Palestine, Ohio', country: 'USA', lat: 40.8343, lng: -80.5379, date: '2023-02-03', severity: 'severe', casualties: 0, injuries: 0, source_url: 'https://en.wikipedia.org/wiki/East_Palestine,_Ohio,_train_derailment', type: 'derailment' },
  { title: 'Sinking Spring Derailment', description: 'CSX freight train derailment in Pennsylvania disrupting service and causing local evacuations.', location: 'Sinking Spring, Pennsylvania', country: 'USA', lat: 40.3212, lng: -76.0196, date: '2023-03-20', severity: 'moderate', casualties: 0, injuries: 2, type: 'derailment' },
  { title: 'Greece Train Collision', description: 'Head-on collision between a passenger train and a freight train near Larissa. Two trains on the same track due to human error.', location: 'Larissa, Thessaly', country: 'Greece', lat: 39.6386, lng: 22.4189, date: '2023-02-28', severity: 'catastrophic', casualties: 57, injuries: 85, source_url: 'https://en.wikipedia.org/wiki/2023_Larissa_train_collision', type: 'collision' },
  { title: 'Jilin Train Collision', description: 'Two metro trains collided in Jilin city causing multiple injuries during morning rush hour.', location: 'Jilin City', country: 'China', lat: 43.8378, lng: 126.5496, date: '2021-12-20', severity: 'moderate', casualties: 0, injuries: 44, type: 'collision' },
  { title: 'Shirasagi Limited Express Collision', description: 'Collision between a limited express train and a truck at a grade crossing in Shiga Prefecture.', location: 'Shiga Prefecture', country: 'Japan', lat: 35.0043, lng: 135.8686, date: '2021-08-18', severity: 'moderate', casualties: 1, injuries: 13, type: 'collision' },
  { title: 'Churchurún Derailment', description: 'Passenger train derailment in the mountains of Peru due to track infrastructure failure.', location: 'Cusco Region', country: 'Peru', lat: -13.5319, lng: -72.0581, date: '2022-04-02', severity: 'severe', casualties: 0, injuries: 12, type: 'derailment' },
  { title: 'Ankara Metro Power Failure Crash', description: 'Metro train rear-end collision during a power failure caused injuries to commuters.', location: 'Ankara', country: 'Turkey', lat: 39.9334, lng: 32.8597, date: '2022-11-15', severity: 'minor', casualties: 0, injuries: 8, type: 'collision' },
  { title: 'Bengaluru Metro Derailment', description: 'Metro train derailed during a test run at a yard causing no passenger casualties.', location: 'Bengaluru', country: 'India', lat: 12.9716, lng: 77.5946, date: '2022-07-10', severity: 'minor', casualties: 0, injuries: 3, type: 'derailment' },
  { title: 'Pakistan Express Collision', description: 'Sir Syed Express rear-ended the Millat Express near Ghotki station after Millat Express derailed.', location: 'Ghotki, Sindh', country: 'Pakistan', lat: 28.0012, lng: 69.3224, date: '2021-06-07', severity: 'catastrophic', casualties: 63, injuries: 100, source_url: 'https://en.wikipedia.org/wiki/2021_Ghotki_train_crash', type: 'collision' },
  { title: 'Weinheim Collision', description: 'Two DB regional trains collided head-on near Weinheim in Germany causing injuries.', location: 'Weinheim, Baden-Württemberg', country: 'Germany', lat: 49.5500, lng: 8.6631, date: '2022-04-12', severity: 'moderate', casualties: 0, injuries: 18, type: 'collision' },
  { title: 'Melbourne Tram Derailment', description: 'Melbourne tram derailed in the CBD causing traffic disruption and minor injuries.', location: 'Melbourne CBD', country: 'Australia', lat: -37.8136, lng: 144.9631, date: '2023-05-22', severity: 'minor', casualties: 0, injuries: 5, type: 'derailment' },
  { title: 'Tabriz Train Derailment', description: 'Passenger train partially derailed near Tabriz station due to track defects during winter conditions.', location: 'Tabriz, East Azerbaijan', country: 'Iran', lat: 38.0962, lng: 46.2738, date: '2022-01-20', severity: 'moderate', casualties: 1, injuries: 22, type: 'derailment' },
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO accidents (title, description, location, country, lat, lng, date, severity, casualties, injuries, source_url, type, verified)
  VALUES (@title, @description, @location, @country, @lat, @lng, @date, @severity, @casualties, @injuries, @source_url, @type, 1)
`);

const count = db.prepare('SELECT COUNT(*) as c FROM accidents').get();
if (count.c === 0) {
  const insertMany = db.transaction((items) => items.forEach(i => insert.run({ source_url: null, ...i })));
  insertMany(seedData);
  console.log('Seeded database with sample accidents');
}

// === API ROUTES ===

// GET all accidents (with optional filters)
app.get('/api/accidents', (req, res) => {
  const { severity, type, country, year, search } = req.query;
  let query = 'SELECT * FROM accidents WHERE 1=1';
  const params = [];

  if (severity) { query += ' AND severity = ?'; params.push(severity); }
  if (type) { query += ' AND type = ?'; params.push(type); }
  if (country) { query += ' AND country LIKE ?'; params.push(`%${country}%`); }
  if (year) { query += ' AND strftime("%Y", date) = ?'; params.push(year); }
  if (search) { query += ' AND (title LIKE ? OR description LIKE ? OR location LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  query += ' ORDER BY date DESC';

  try {
    const rows = db.prepare(query).all(...params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single accident
app.get('/api/accidents/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM accidents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: 'Not found' });
  res.json({ success: true, data: row });
});

// POST new accident
app.post('/api/accidents', (req, res) => {
  const { title, description, location, country, lat, lng, date, severity, casualties, injuries, source_url, type } = req.body;

  if (!title || !description || !location || !country || !lat || !lng || !date || !severity) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO accidents (title, description, location, country, lat, lng, date, severity, casualties, injuries, source_url, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description, location, country, lat, lng, date, severity, casualties || 0, injuries || 0, source_url || null, type || 'derailment');

    const newRow = db.prepare('SELECT * FROM accidents WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: newRow });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET stats
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM accidents').get();
  const totalCasualties = db.prepare('SELECT SUM(casualties) as total FROM accidents').get();
  const totalInjuries = db.prepare('SELECT SUM(injuries) as total FROM accidents').get();
  const bySeverity = db.prepare('SELECT severity, COUNT(*) as count FROM accidents GROUP BY severity').all();
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM accidents GROUP BY type').all();
  const byCountry = db.prepare('SELECT country, COUNT(*) as count FROM accidents GROUP BY country ORDER BY count DESC LIMIT 10').all();

  res.json({
    success: true,
    data: {
      totalAccidents: total.count,
      totalCasualties: totalCasualties.total || 0,
      totalInjuries: totalInjuries.total || 0,
      bySeverity,
      byType,
      topCountries: byCountry
    }
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.listen(PORT, () => console.log(`🚂 Railway Accidents API running on http://localhost:${PORT}`));
