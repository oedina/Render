import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { data, error } = await supabase.from('accidents').select('severity, type, country, casualties, injuries');
  if (error) return res.status(500).json({ success: false, error: error.message });

  const totalAccidents = data.length;
  const totalCasualties = data.reduce((s, r) => s + (r.casualties || 0), 0);
  const totalInjuries = data.reduce((s, r) => s + (r.injuries || 0), 0);

  const bySeverity = Object.entries(
    data.reduce((acc, r) => { acc[r.severity] = (acc[r.severity] || 0) + 1; return acc; }, {})
  ).map(([severity, count]) => ({ severity, count }));

  const byType = Object.entries(
    data.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {})
  ).map(([type, count]) => ({ type, count }));

  const countryMap = data.reduce((acc, r) => { acc[r.country] = (acc[r.country] || 0) + 1; return acc; }, {});
  const topCountries = Object.entries(countryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, count]) => ({ country, count }));

  res.json({ success: true, data: { totalAccidents, totalCasualties, totalInjuries, bySeverity, byType, topCountries } });
}
