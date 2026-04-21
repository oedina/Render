import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const TAVILY_API = 'https://api.tavily.com/search';

// DeepSeek V3 — free, strong at structured extraction
const MODEL = 'deepseek/deepseek-chat-v3-0324:free';

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

// Search Tavily for railway accident news in the date range
async function searchNews(dateFrom, dateTo, tavilyKey) {
  const queries = [
    `train accident derailment collision ${dateFrom} ${dateTo}`,
    `railway accident crash fatalities ${dateFrom} ${dateTo}`,
    `train fire bridge collapse rail incident ${dateFrom} ${dateTo}`
  ];

  const allResults = [];

  for (const query of queries) {
    try {
      const r = await fetch(TAVILY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          search_depth: 'basic',
          max_results: 7,
          include_answer: false,
          include_raw_content: false,
          // Filter by date range
          days: Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1
        })
      });
      const data = await r.json();
      if (data.results) allResults.push(...data.results);
    } catch (e) {
      console.error('Tavily query failed:', e.message);
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  return allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required' });

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (!openrouterKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  if (!tavilyKey) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });

  try {
    // ── Step 1: Tavily searches the web for current railway news ──────
    const articles = await searchNews(dateFrom, dateTo, tavilyKey);

    if (!articles.length) {
      return res.status(200).json({ success: true, inserted: 0, skipped: 0, total: 0, data: [], note: 'No articles found by Tavily' });
    }

    // Build a compact summary of articles for the AI to parse
    const articleSummary = articles.map((a, i) =>
      `[${i + 1}] URL: ${a.url}\nTitle: ${a.title}\nSnippet: ${a.content?.slice(0, 400) || ''}`
    ).join('\n\n');

    // ── Step 2: DeepSeek extracts structured incident data ────────────
    const extractPrompt = `You are a railway safety data extractor. Below are ${articles.length} news article snippets about railway incidents found between ${dateFrom} and ${dateTo}.

Extract each real railway accident into a structured JSON record. Only extract genuine railway accidents — skip unrelated articles.

For each incident extract:
- title: short descriptive name with location e.g. "Odisha Train Collision, India"
- description: 2-3 factual sentences about what happened including casualties if mentioned
- location: specific city or region where it happened
- country: country name
- lat: latitude as a number (your best estimate for the location)
- lng: longitude as a number (your best estimate for the location)
- date: date the incident OCCURRED in YYYY-MM-DD format (not the article publication date)
- severity: minor / moderate / severe / catastrophic
- casualties: number killed (0 if none mentioned)
- injuries: number injured (0 if none mentioned)
- source_url: the article URL from the list above
- type: derailment / collision / fire / bridge_failure / other
- mrs: best match from:
  Train Derailment, Train Collision, Major Structural Failure or Collapse,
  Electrocution, Fire on Railway Premises, Train Fire,
  Platform-Train Interface Incident, Person Struck by Train,
  Impact from Fallen Objects, Major Escalator or Lift Incident,
  Fall from or out of Train, Environmental or Natural Disaster,
  Crowd-Related Incident

ARTICLES:
${articleSummary}

Return ONLY a JSON array. No markdown, no explanation:
[{"title":"...","description":"...","location":"...","country":"...","lat":0.0,"lng":0.0,"date":"YYYY-MM-DD","severity":"moderate","casualties":0,"injuries":0,"source_url":"...","type":"derailment","mrs":"Train Derailment"}]

If no genuine railway accidents are found, return: []`;

    const orRes = await fetch(OPENROUTER_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://render-rosy.vercel.app',
        'X-Title': 'RailAlert'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        temperature: 0.1,
        messages: [{ role: 'user', content: extractPrompt }]
      })
    });

    const orData = await orRes.json();
    if (orData.error) return res.status(500).json({ error: orData.error.message || 'OpenRouter error' });

    const rawText = orData.choices?.[0]?.message?.content || '';
    if (!rawText) return res.status(500).json({ error: 'No response from AI' });

    // Parse JSON response
    let accidents = [];
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('[');
      const end = clean.lastIndexOf(']');
      if (start === -1 || end === -1) throw new Error('No JSON array found');
      accidents = JSON.parse(clean.slice(start, end + 1));
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse AI response', raw: rawText.slice(0, 1000) });
    }

    if (!Array.isArray(accidents) || !accidents.length) {
      return res.status(200).json({ success: true, inserted: 0, skipped: 0, total: 0, data: [], articlesFound: articles.length });
    }

    // ── Step 3: Server-side validation ───────────────────────────────
    const from = new Date(dateFrom);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);
    const now = new Date();

    const rejectedItems = [];
    const validAccidents = accidents.filter(acc => {
      if (!acc.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(acc.date))) {
        rejectedItems.push({ title: acc.title, reason: 'invalid date format', date: acc.date });
        return false;
      }
      const [y, m, d] = String(acc.date).split('-').map(Number);
      const incidentDate = new Date(y, m - 1, d);
      if (incidentDate < from || incidentDate > toDate) {
        rejectedItems.push({ title: acc.title, reason: 'date out of range', date: acc.date });
        return false;
      }
      if (incidentDate > now) {
        rejectedItems.push({ title: acc.title, reason: 'date in future', date: acc.date });
        return false;
      }
      if (!acc.title || !acc.country) {
        rejectedItems.push({ title: acc.title, reason: 'missing title or country', date: acc.date });
        return false;
      }
      if (acc.lat === 0 && acc.lng === 0) {
        rejectedItems.push({ title: acc.title, reason: 'zero coordinates', date: acc.date });
        return false;
      }
      return true;
    });

    // ── Step 4: Insert into Supabase, skipping duplicates ─────────────
    let inserted = 0, skipped = 0;
    const insertedRows = [];

    for (const acc of validAccidents) {
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

      // Duplicate check: title + date
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
        lat:         parseFloat(acc.lat) || 0,
        lng:         parseFloat(acc.lng) || 0,
        date:        acc.date,
        severity:    ['minor','moderate','severe','catastrophic'].includes(acc.severity) ? acc.severity : 'moderate',
        casualties:  Math.max(0, parseInt(acc.casualties) || 0),
        injuries:    Math.max(0, parseInt(acc.injuries) || 0),
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
      rejected: rejectedItems.length,
      total: accidents.length,
      articlesSearched: articles.length,
      data: insertedRows,
      rejectedDetails: rejectedItems
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
