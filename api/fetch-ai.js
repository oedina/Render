import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

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
    // Step 1: Use Claude with web search to find real accidents in the date range
    const searchPrompt = `Search the web for real railway and train accidents that occurred between ${dateFrom} and ${dateTo} worldwide. 

For each accident found, extract:
- title (short descriptive name)
- description (2-3 sentences about what happened)
- location (city/region)
- country
- lat (latitude as number)
- lng (longitude as number)  
- date (YYYY-MM-DD format)
- severity (must be exactly one of: minor, moderate, severe, catastrophic)
  - minor: no deaths, few injuries, minimal disruption
  - moderate: 1-5 deaths OR significant injuries/disruption
  - severe: 6-20 deaths OR major infrastructure damage
  - catastrophic: 20+ deaths OR national/international significance
- casualties (number of deaths, 0 if none)
- injuries (number injured, 0 if none)
- source_url (URL of the news article or Wikipedia page)
- type (must be exactly one of: derailment, collision, fire, bridge_failure, other)

Find as many real incidents as you can (aim for 10-20). Only include verified real events with sources.

Respond ONLY with a valid JSON array. No markdown, no explanation, no backticks. Just the raw JSON array like:
[{"title":"...","description":"...","location":"...","country":"...","lat":0.0,"lng":0.0,"date":"YYYY-MM-DD","severity":"moderate","casualties":0,"injuries":0,"source_url":"https://...","type":"derailment"}]`;

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
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: searchPrompt }]
      })
    });

    const claudeData = await claudeRes.json();

    if (claudeData.error) {
      return res.status(500).json({ error: claudeData.error.message || 'Claude API error' });
    }

    // Extract the text response (last text block)
    const textBlocks = (claudeData.content || []).filter(b => b.type === 'text');
    if (!textBlocks.length) return res.status(500).json({ error: 'No response from AI' });

    const rawText = textBlocks[textBlocks.length - 1].text;

    // Parse JSON - strip any markdown fences just in case
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
      return res.status(200).json({ success: true, inserted: 0, skipped: 0, data: [] });
    }

    // Step 2: Insert into Supabase, skipping duplicates (same title + date)
    let inserted = 0, skipped = 0;
    const insertedRows = [];

    for (const acc of accidents) {
      // Validate required fields
      if (!acc.title || !acc.date || !acc.lat || !acc.lng || !acc.country) { skipped++; continue; }

      // Check for duplicate (same title and date)
      const { data: existing } = await supabase
        .from('accidents')
        .select('id')
        .eq('title', acc.title)
        .eq('date', acc.date)
        .maybeSingle();

      if (existing) { skipped++; continue; }

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
      else if (error) { skipped++; }
    }

    return res.status(200).json({
      success: true,
      inserted,
      skipped,
      total: accidents.length,
      data: insertedRows
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
