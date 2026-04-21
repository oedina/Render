import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
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
    const searchPrompt = `You are a railway safety data recorder. Your ONLY job is to record real, verified railway incidents with 100% accurate information.

STRICT ACCURACY RULES — violating any of these means the record is REJECTED:

1. DATE ACCURACY (most critical):
   - The date field MUST be the actual date the incident OCCURRED, taken directly from the news article or official report.
   - Do NOT use today's date. Do NOT use the article's publication date if the incident happened earlier.
   - If an article published on 2026-04-21 says "the crash happened on January 19", the date is 2026-01-19.
   - If you are not certain of the exact incident date, set the record aside — do NOT guess or approximate.
   - Only include incidents where the occurrence date falls between ${dateFrom} and ${dateTo}.

2. FACT ACCURACY:
   - casualty and injury numbers must come directly from the source. If the article says "at least 3 dead", use 3.
   - Do NOT round up, speculate, or use "estimated" numbers without noting they are estimates.
   - location must be the specific place the incident occurred, not the nearest city if you are uncertain.
   - country must be correct — double-check for incidents near borders.

3. SOURCE ACCURACY:
   - source_url must be a real, specific article URL you are confident exists.
   - If you are not certain the URL is real and accessible, set source_url to null — do NOT fabricate URLs.
   - Never use a homepage URL (e.g. bbc.com) — only direct article URLs.

4. COMPLETENESS RULES:
   - If ANY required field cannot be verified with confidence, exclude the entire incident.
   - It is better to return 3 accurate incidents than 10 uncertain ones.
   - Never include an incident just to fill the list.

5. NO HALLUCINATION:
   - Every incident must be a real event you have clear knowledge of.
   - Do not combine two separate incidents into one.
   - Do not infer details not stated in sources.

For each verified incident provide:
- title: specific descriptive name with location (e.g. "Odisha Triple Train Collision, India")
- description: 2-3 factual sentences. State casualties as reported. Note if figures are preliminary.
- location: exact place of incident
- country: country where incident occurred
- lat: latitude of incident location (number)
- lng: longitude of incident location (number)
- date: YYYY-MM-DD — the date the incident OCCURRED (not published, not today)
- severity:
    minor = no deaths, minor injuries or disruption
    moderate = 1–5 deaths OR significant injuries/service disruption
    severe = 6–20 deaths OR major infrastructure damage
    catastrophic = 20+ deaths OR national/international significance
- casualties: confirmed death toll as a number (0 if none confirmed)
- injuries: confirmed injury count as a number (0 if none confirmed)
- source_url: direct URL to source article, or null if uncertain
- type: exactly one of: derailment, collision, fire, bridge_failure, other
- mrs: the single most applicable category from this exact list:
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

Respond ONLY with a valid JSON array. No markdown, no explanation, no backticks.
If no verified incidents exist for this period, return an empty array: []

Example of a correctly formatted record:
[{"title":"Balasore Triple Train Collision, India","description":"Three trains collided near Balasore, Odisha in one of India's deadliest rail disasters. The Coromandel Express derailed and struck a goods train, with the wreckage then hit by the Yesvantpur–Howrah Express. Casualty figures were updated over several days as rescue operations continued.","location":"Balasore, Odisha","country":"India","lat":21.49,"lng":86.93,"date":"2023-06-02","severity":"catastrophic","casualties":296,"injuries":1200,"source_url":"https://www.bbc.com/news/world-asia-india-65793935","type":"collision","mrs":"Train Collision"}]`;

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
        temperature: 0.0,  // zero temperature = most factual, least creative
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

    // Server-side validation — hard reject anything outside the date range
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    // Set to end of day for the to date
    to.setHours(23, 59, 59, 999);

    const validAccidents = accidents.filter(acc => {
      if (!acc.date || typeof acc.date !== 'string') return false;
      // Must match YYYY-MM-DD format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(acc.date)) return false;
      const [y, m, d] = acc.date.split('-').map(Number);
      const incidentDate = new Date(y, m - 1, d);
      // Reject if outside range
      if (incidentDate < from || incidentDate > to) return false;
      // Reject if date is in the future
      if (incidentDate > new Date()) return false;
      // Reject if missing critical fields
      if (!acc.title || !acc.country || !acc.lat || !acc.lng) return false;
      // Reject if coordinates are (0,0) — likely a placeholder
      if (acc.lat === 0 && acc.lng === 0) return false;
      // Reject if casualties or injuries are negative
      if ((acc.casualties || 0) < 0 || (acc.injuries || 0) < 0) return false;
      return true;
    });

    const rejectedCount = accidents.length - validAccidents.length;

    let inserted = 0, skipped = 0;
    const insertedRows = [];

    for (const acc of validAccidents) {
      // Duplicate check 1: same date + country + type + casualties
      const { data: existing } = await supabase
        .from('accidents')
        .select('id')
        .eq('date', acc.date)
        .eq('country', String(acc.country).slice(0, 100))
        .eq('type', ['derailment','collision','fire','bridge_failure','other'].includes(acc.type) ? acc.type : 'other')
        .eq('casualties', parseInt(acc.casualties) || 0)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      // Duplicate check 2: same title + date
      const { data: existingByTitle } = await supabase
        .from('accidents')
        .select('id')
        .eq('title', String(acc.title).slice(0, 200))
        .eq('date', acc.date)
        .maybeSingle();

      if (existingByTitle) { skipped++; continue; }

      const { data: newRow, error } = await supabase.from('accidents').insert([{
        title:       String(acc.title).slice(0, 200),
        description: String(acc.description || '').slice(0, 2000),
        location:    String(acc.location || '').slice(0, 200),
        country:     String(acc.country).slice(0, 100),
        lat:         parseFloat(acc.lat),
        lng:         parseFloat(acc.lng),
        date:        acc.date,
        severity:    ['minor','moderate','severe','catastrophic'].includes(acc.severity) ? acc.severity : 'moderate',
        casualties:  parseInt(acc.casualties) || 0,
        injuries:    parseInt(acc.injuries) || 0,
        source_url:  acc.source_url || null,
        type:        ['derailment','collision','fire','bridge_failure','other'].includes(acc.type) ? acc.type : 'other',
        mrs:         VALID_MRS.includes(acc.mrs) ? acc.mrs : null,
        verified:    false
      }]).select().single();

      if (!error && newRow) { insertedRows.push(newRow); inserted++; }
      else { skipped++; }
    }

    return res.status(200).json({
      success: true,
      inserted,
      skipped,
      rejected: rejectedCount,
      total: accidents.length,
      data: insertedRows
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
