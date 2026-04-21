import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, secret, dateFrom, dateTo } = req.body;

  // Basic protection — require a secret key
  if (secret !== process.env.CLEANUP_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // DELETE all accidents
  if (action === 'delete-all') {
    const { error, count } = await supabase
      .from('accidents')
      .delete()
      .neq('id', 0)  // matches all rows
      .select('id', { count: 'exact', head: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, message: 'All accidents deleted' });
  }

  // DELETE outside date range
  if (action === 'delete-outside-range') {
    if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required' });
    const { data, error } = await supabase
      .from('accidents')
      .delete()
      .or(`date.lt.${dateFrom},date.gt.${dateTo}`)
      .select('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, deleted: data.length });
  }

  // DELETE duplicates (keep lowest id per date+country+type+casualties)
  if (action === 'delete-duplicates') {
    const { data: all, error } = await supabase
      .from('accidents')
      .select('id, date, country, type, casualties')
      .order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const seen = new Map();
    const toDelete = [];
    for (const row of all) {
      const key = `${row.date}|${row.country}|${row.type}|${row.casualties}`;
      if (seen.has(key)) toDelete.push(row.id);
      else seen.set(key, row.id);
    }
    if (!toDelete.length) return res.json({ success: true, deleted: 0, message: 'No duplicates found' });

    const { error: delError } = await supabase.from('accidents').delete().in('id', toDelete);
    if (delError) return res.status(500).json({ error: delError.message });
    return res.json({ success: true, deleted: toDelete.length });
  }

  return res.status(400).json({ error: 'Unknown action. Use: delete-all, delete-outside-range, delete-duplicates' });
}
