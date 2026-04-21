import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
// Auto-selects the best available free model — never goes down
const MODEL = 'openrouter/auto';

const VALID_MRS = [
  'Train Derailment',
  'Train Collision',
  'Major Structural Failure or Collapse',
  'Electrocution',
  'Fire on Railway Premises',
  'Train Fire',
  'Platform-Train Interface Incident',
  'Person Struck by Train',
  'Impact from Fallen Objects',
  'Major Escalator or Lift Incident',
  'Fall from or out of Train',
  'Environmental or Natural Disaster',
  'Crowd-Related Incident'
];

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
    const searchPrompt = `You are a railway safety data assistant. List real railway and train accidents that occurred STRICTLY between ${dateFrom} and ${dateTo} worldwide.

CRITICAL RULES:
- Only include incidents where the date is between ${dateFrom} and ${dateTo}. Reject anything outside this range.
- Do NOT invent or hallucinate incidents. Only include ones you are confident about.
- If you are not sure of the exact date, skip that incident.

For each accident provide these exact fields:
- title: short unique descriptive name including location (e.g. "Odisha Train Collision, India")
- description: 2-3 sentences about what happened
- location: city/region
- country
- lat: latitude as a number
- lng: longitude as a number
- date: YYYY-MM-DD, must be between ${dateFrom} and ${dateTo}
- severity: exactly one of: minor, moderate, severe, catastrophic
- casualties: number of deaths (0 if none)
- injuries: number injured (0 if none)
- source_url: a real news URL if known, otherwise null
- type: exactly one of: derailment, collision, fire, bridge_failure, other
- mrs: the single most applicable Railway Major Risk Scenario from this exact list:
  "Train Derailment"
  "Train Collision"
  "Major Structural Failure or Collapse"
  "Electrocution"
  "Fire on Railway Premises"
  "Train Fire"
  "Platform-Train Interface Incident"
  "Person Struck by Train"
  "Impact from Fallen Objects"
  "Major Escalator or Lift Incident"
  "Fall from or out of Train"
  "Environmental or Natural Disaster"
  "Crowd-Related Incident"

Respond ONLY with a valid JSON array. No markdown, no explanation, no backticks:
[{"title":"...","description":"...","location":"...","country":"...","lat":0.0,"lng":0.0,"date":"YYYY-MM-DD","severity":"moderate","casualties":0,"injuries":0,"source_url":null,"type":"derailment","mrs":"Train Derailment"}]

If no verified incidents found in this date range, return: []`;

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
    if (orData.error) return res.status(500).json({ error: orData.error.message || 'OpenRouter API error' });

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

    // Filter out any incidents outside the requested date range
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

      // Duplicate check: date + country + type + casualties
      const { data: existing } = await supabase
        .from('accidents')
        .select('id')
        .eq('date', acc.date)
        .eq('country', String(acc.country).slice(0, 100))
        .eq('type', ['derailment','collision','fire','bridge_failure','other'].includes(acc.type) ? acc.type : 'other')
        .eq('casualties', parseInt(acc.casualties) || 0)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      // Also check by title+date
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
        mrs: VALID_MRS.includes(acc.mrs) ? acc.mrs : null,
        verified: false
      }]).select().single();

      if (!error && newRow) { insertedRows.push(newRow); inserted++; }
      else { skipped++; }
    }

    return res.status(200).json({
      success: true,
      inserted,
      skipped,
      total: accidents.length,
      filteredOut: accidents.length - validAccidents.length,
      data: insertedRows
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
