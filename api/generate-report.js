import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.0-flash-exp:free';

function getISOWeek(dateStr) {
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const weekOfYear = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return weekOfYear;
}

function formatDate(d) {
  const [year, month, day] = d.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

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
    const { data: accidents, error } = await supabase
      .from('accidents')
      .select('*')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const weekFrom = getISOWeek(dateFrom);
    const weekTo = getISOWeek(dateTo);
    const weekRange = weekFrom === weekTo ? `CW${weekFrom}` : `CW${weekFrom}–CW${weekTo}`;
    const periodLabel = `${formatDate(dateFrom)} – ${formatDate(dateTo)}`;

    const incidentsSummary = accidents.length > 0
      ? accidents.map((a, i) => `Incident ${i + 1}: ${a.title} | ${a.date} | ${a.country} | ${a.location} | ${a.type} | ${a.severity} | ${a.casualties} deaths | ${a.injuries} injuries | ${a.description} | Source: ${a.source_url || 'N/A'}`).join('\n')
      : `No incidents in database. Use your knowledge of real railway accidents in the period ${periodLabel} to populate the report.`;

    const prompt = `You are a professional railway safety analyst. Generate a formal "Worldwide Rail Incidents Alert" JSON report for the period ${periodLabel} (${weekRange}).

${accidents.length > 0 ? `DATABASE INCIDENTS (${accidents.length} total):\n${incidentsSummary}` : `No DB data — use your knowledge of real incidents:\n${incidentsSummary}`}

MRS categories allowed:
Train Derailment, Train Collision, Major Structural Failure or Collapse, Electrocution, Fire on Railway Premises, Train Fire, Platform–Train Interface Incident, Person Struck by Train, Impact from Fallen Objects, Major Escalator or Lift Incident, Fall from or out of Train, Environmental or Natural Disaster, Crowd-Related Incident

Return ONLY this JSON object, no markdown, no backticks, no explanation:
{
  "title": "Worldwide Rail Incidents Alert",
  "period": "${periodLabel}",
  "calendarWeeks": "${weekRange}",
  "dateGenerated": "${new Date().toISOString().split('T')[0]}",
  "totalIncidents": <number>,
  "executiveSummary": "<2-3 sentence professional overview>",
  "headlineSummary": [
    {"number": 1, "mrs": "<MRS Category>", "country": "<country>", "date": "<YYYY-MM-DD>", "headline": "<one sentence factual description>"}
  ],
  "incidents": [
    {
      "refNumber": "RAI-${new Date().getFullYear()}-001",
      "title": "<title>",
      "country": "<country>",
      "location": "<city/region>",
      "date": "<YYYY-MM-DD>",
      "type": "<Accident|Incident|Near Miss>",
      "operator": "<operator or Unknown>",
      "mrs": "<MRS Category>",
      "severity": "<minor|moderate|severe|catastrophic>",
      "casualties": <number>,
      "injuries": <number>,
      "description": "<3-5 sentence factual narrative>",
      "causes": "<known causes or Under investigation>",
      "safetyObservations": "<safety observations or lessons>",
      "sourceUrl": "<url or null>",
      "sourceLabel": "<publication name>"
    }
  ],
  "statisticsSummary": {
    "byMRS": [{"category": "<MRS>", "count": <n>}],
    "bySeverity": {"minor": <n>, "moderate": <n>, "severe": <n>, "catastrophic": <n>},
    "byCountry": [{"country": "<name>", "count": <n>}],
    "totalFatalities": <number>,
    "totalInjuries": <number>
  },
  "closingNote": "<1-2 sentence professional closing>"
}`;

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
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const orData = await orRes.json();
    if (orData.error) return res.status(500).json({ error: orData.error.message || 'OpenRouter API error' });

    const rawText = orData.choices?.[0]?.message?.content || '';
    if (!rawText) return res.status(500).json({ error: 'No response from AI' });

    let report;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      report = JSON.parse(clean.slice(start, end + 1));
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse report JSON', raw: rawText.slice(0, 500) });
    }

    return res.status(200).json({ success: true, report });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
