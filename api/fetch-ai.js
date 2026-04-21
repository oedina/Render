import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
// Auto-selects the best available free model — never goes down
const MODEL = 'openrouter/auto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

  try {
    const searchPrompt = `You are a railway safety data assistant. Your task is to list ONLY real railway and train accidents that occurred STRICTLY between ${dateFrom} and ${dateTo} (inclusive). 

CRITICAL RULES:
- Only include incidents where the date is between ${dateFrom} and ${dateTo}. Reject anything outside this range.
- Do NOT include incidents from other years even if they seem similar.
- Do NOT invent or hallucinate incidents. Only include ones you are confident about.
- If you are not sure of the exact date, skip that incident.

For each accident provide these exact fields:
- title: short unique descriptive name including the location (e.g. "Odisha Train Collision, India")
- description: 2-3 sentences about what happened
- location: city/region
- country
- lat: latitude as a number
- lng: longitude as a number
- date: YYYY-MM-DD format, must be between ${dateFrom} and ${dateTo}
- severity: exactly one of: minor, moderate, severe, catastrophic
  - minor: no deaths, few injuries
  - moderate: 1-5 deaths OR significant injuries
  - severe: 6-20 deaths OR major infrastructure damage
  - catastrophic: 20+ deaths OR national significance
- casualties: number of deaths (0 if none)
- injuries: number injured (0 if none)
- source_url: a real news URL if you know one, otherwise null
- type: exactly one of: derailment, collision, fire, bridge_failure, other

Respond ONLY with a valid JSON array. No markdown, no explanation, no backticks. Example:
[{"title":"Example Derailment, France","description":"A passenger train derailed...","location":"Lyon","country":"France","lat":45.75,"lng":4.85,"date":"${dateFrom}","severity":"moderate","casualties":2,"injuries":15,"source_url":null,"type":"derailment"}]

If you cannot find any verified incidents in this exact date range, return an empty array: []`;

    const orRes = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://render-rosy.vercel.app',
        'X-Title': 'RailAlert'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        temperature: 0.1,
        messages: [{ role: 'user', content: searchPrompt }]
      })
    });

    const orData = await orRes.json();

    if (orData.error) {
      return res.status(500).json({ error: orData.error.message || 'OpenRouter API error' });
    }

    const rawText = orData.choices?.[0]?.message?.content || '';
    if (!rawText) return res.status(500).json({ error: 'No response from AI' });

    let accidents = [];
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('[');
      const end = clean.lastIndexOf(']');
      if (start === -1 || end === -1) throw new Error('No JSON array found');
      accidents = JSON.parse(clean.slice(start, end + 1));
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse AI response', raw: rawText.slice(0, 500) });
    }

    if (!Array.isArray(accidents) || !accidents.length) {
      return res.status(200).json({ success: true, inserted: 0, skipped: 0, total: 0, data: [] });
    }

    // Filter out any incidents outside the requested date range (AI safety net)
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const validAccidents = accidents.filter(acc => {
      if (!acc.date) return false;
      const d = new Date(acc.date);
      return d >= from && d <= to;
    });

    let inserted = 0, skipped = 0;
    const insertedRows = [];

    for (const acc of validAccidents) {
      if (!acc.title || !acc.date || !acc.lat || !acc.lng || !acc.country) { skipped++; continue; }

      // Improved duplicate check: match on date + country + type + similar casualties
      // to catch same incident with slightly different titles
      const { data: existing } = await supabase
        .from('accidents')
        .select('id')
        .eq('date', acc.date)
        .eq('country', String(acc.country).slice(0, 100))
        .eq('type', ['derailment','collision','fire','bridge_failure','other'].includes(acc.type) ? acc.type : 'other')
        .eq('casualties', parseInt(acc.casualties) || 0)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      // Also check by title+date as before
      const { data: existingByTitle } = await supabase
        .from('accidents')
        .select('id')
        .eq('title', String(acc.title).slice(0, 200))
        .eq('date', acc.date)
        .maybeSingle();

      if (existingByTitle) { skipped++; continue; }

      const { data: newRow, error } = await supabase.from('accidents').insert([{
        title: String(acc.title).slice(0, 200),
        description: String(acc.description || '').slice(0, 2000),
        location: String(acc.location || '').slice(0, 200),
        country: String(acc.country).slice(0, 100),
        lat: parseFloat(acc.lat) || 0,
        lng: parseFloat(acc.lng) || 0,
        date: acc.date,
        severity: ['minor','moderate','severe','catastrophic'].includes(acc.severity) ? acc.severity : 'moderate',
        casualties: parseInt(acc.casualties) || 0,
        injuries: parseInt(acc.injuries) || 0,
        source_url: acc.source_url || null,
        type: ['derailment','collision','fire','bridge_failure','other'].includes(acc.type) ? acc.type : 'other',
        verified: false
      }]).select().single();

      if (!error && newRow) { insertedRows.push(newRow); inserted++; }
      else { skipped++; }
    }

    const filteredOut = accidents.length - validAccidents.length;

    return res.status(200).json({
      success: true,
      inserted,
      skipped,
      total: accidents.length,
      filteredOut,
      data: insertedRows
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
