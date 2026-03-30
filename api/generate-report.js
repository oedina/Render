import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Calculate ISO week number
function getISOWeek(dateStr) {
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const weekOfYear = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return weekOfYear;
}

function formatDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dateFrom, dateTo } = req.body;
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    // Fetch accidents from Supabase for the period
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

    // Build the prompt for Claude to generate the structured report
    const incidentsSummary = accidents.length > 0
      ? accidents.map((a, i) => `
Incident ${i + 1}:
- Title: ${a.title}
- Date: ${a.date}
- Country: ${a.country}
- Location: ${a.location}
- Type: ${a.type}
- Severity: ${a.severity}
- Fatalities: ${a.casualties}
- Injuries: ${a.injuries}
- Description: ${a.description}
- Source: ${a.source_url || 'Not available'}
`).join('\n')
      : 'No incidents found in the database for this period. Use your knowledge and web search to find real incidents in this date range.';

    const prompt = `You are a professional railway safety analyst producing a formal "Worldwide Rail Incidents Alert" report. Generate the full report for the period ${periodLabel} (${weekRange}).

${accidents.length > 0 ? `DATABASE INCIDENTS (${accidents.length} found):` : 'No DB incidents — search for real ones:'}
${incidentsSummary}

${accidents.length === 0 ? 'Search the web for real railway accidents in this period and include them.' : ''}

Generate a complete, professional report in the following EXACT JSON structure. Do not add markdown, backticks, or any text outside the JSON.

The MRS categories must be one of:
- Train Derailment
- Train Collision
- Major Structural Failure or Collapse
- Electrocution
- Fire on Railway Premises
- Train Fire
- Platform–Train Interface Incident
- Person Struck by Train
- Impact from Fallen Objects
- Major Escalator or Lift Incident
- Fall from or out of Train
- Environmental or Natural Disaster
- Crowd-Related Incident

Return ONLY this JSON:
{
  "title": "Worldwide Rail Incidents Alert",
  "period": "${periodLabel}",
  "calendarWeeks": "${weekRange}",
  "dateGenerated": "${new Date().toISOString().split('T')[0]}",
  "totalIncidents": <number>,
  "executiveSummary": "<2-3 sentence professional overview of the reporting period>",
  "headlineSummary": [
    {
      "number": 1,
      "mrs": "<MRS Category>",
      "country": "<country>",
      "date": "<YYYY-MM-DD>",
      "headline": "<one sentence factual description with casualties if any>"
    }
  ],
  "incidents": [
    {
      "refNumber": "RAI-<YYYY>-<CW>-001",
      "title": "<incident title>",
      "country": "<country>",
      "location": "<city/region>",
      "date": "<YYYY-MM-DD>",
      "type": "<Accident | Incident | Near Miss>",
      "operator": "<train operator or Unknown>",
      "mrs": "<MRS Category>",
      "severity": "<minor|moderate|severe|catastrophic>",
      "casualties": <number>,
      "injuries": <number>,
      "description": "<objective 3-5 sentence factual incident narrative>",
      "causes": "<known or preliminary causes, or 'Under investigation' if not yet determined>",
      "safetyObservations": "<safety observations, investigation focus areas, or lessons that can be drawn>",
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
  "closingNote": "<1-2 sentence professional closing about the purpose of the alert and safety learning>"
}`;

    const claudeRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        tools: accidents.length === 0 ? [{ type: 'web_search_20250305', name: 'web_search' }] : undefined,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) return res.status(500).json({ error: claudeData.error.message });

    const textBlocks = (claudeData.content || []).filter(b => b.type === 'text');
    if (!textBlocks.length) return res.status(500).json({ error: 'No response from AI' });

    const rawText = textBlocks[textBlocks.length - 1].text;

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
