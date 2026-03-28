import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/accidents
  if (req.method === 'GET') {
    const { severity, type, country, year, search, id } = req.query;

    let query = supabase.from('accidents').select('*');

    if (id) {
      const { data, error } = await query.eq('id', id).single();
      if (error) return res.status(404).json({ success: false, error: error.message });
      return res.json({ success: true, data });
    }

    if (severity) query = query.eq('severity', severity);
    if (type) query = query.eq('type', type);
    if (country) query = query.ilike('country', `%${country}%`);
    if (year) query = query.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,location.ilike.%${search}%`);

    query = query.order('date', { ascending: false });

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, count: data.length, data });
  }

  // POST /api/accidents
  if (req.method === 'POST') {
    const { title, description, location, country, lat, lng, date, severity, casualties, injuries, source_url, type } = req.body;

    if (!title || !description || !location || !country || !lat || !lng || !date || !severity) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const { data, error } = await supabase.from('accidents').insert([{
      title, description, location, country,
      lat: parseFloat(lat), lng: parseFloat(lng),
      date, severity,
      casualties: parseInt(casualties) || 0,
      injuries: parseInt(injuries) || 0,
      source_url: source_url || null,
      type: type || 'derailment',
      verified: false
    }]).select().single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.status(201).json({ success: true, data });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
