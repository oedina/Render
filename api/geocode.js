import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Free geocoding via Nominatim (OpenStreetMap) — no API key needed
async function geocode(location, country) {
  const query = [location, country].filter(Boolean).join(', ');
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'RailAlert/1.0' } }
    );
    const data = await r.json();
    if (data && data[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    // Fallback: try country only
    const r2 = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(country)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'RailAlert/1.0' } }
    );
    const data2 = await r2.json();
    if (data2 && data2[0]) {
      return { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon) };
    }
  } catch (e) {
    console.error('Geocode failed for', query, e.message);
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Fetch all records with missing/zero coordinates
    const { data: records, error } = await supabase
      .from('accidents')
      .select('id, title, location, country, lat, lng')
      .or('lat.eq.0,lng.eq.0');

    if (error) return res.status(500).json({ error: error.message });
    if (!records.length) return res.json({ success: true, message: 'No records need geocoding', fixed: 0 });

    let fixed = 0, failed = 0;
    const results = [];

    for (const rec of records) {
      // Rate limit: Nominatim requires max 1 req/second
      await new Promise(r => setTimeout(r, 1100));

      const coords = await geocode(rec.location, rec.country);

      if (coords && coords.lat && coords.lng) {
        const { error: updateError } = await supabase
          .from('accidents')
          .update({ lat: coords.lat, lng: coords.lng })
          .eq('id', rec.id);

        if (!updateError) {
          fixed++;
          results.push({ id: rec.id, title: rec.title, lat: coords.lat, lng: coords.lng, status: 'fixed' });
        } else {
          failed++;
          results.push({ id: rec.id, title: rec.title, status: 'update_failed', error: updateError.message });
        }
      } else {
        failed++;
        results.push({ id: rec.id, title: rec.title, location: rec.location, country: rec.country, status: 'geocode_failed' });
      }
    }

    return res.json({ success: true, total: records.length, fixed, failed, results });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
