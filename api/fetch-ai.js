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
    const searchPrompt = `List real railway and train accidents worldwide that happened between ${dateFrom} and ${dateTo}.

Include derailments, collisions, fires, and other incidents. For each one give:

title - short name with location e.g. "Odisha Train Collision, India"
description - 2-3 sentences describing what happened, how many died or were injured
location - city or region
country - country name
lat - latitude number
lng - longitude number
date - date the accident happened in YYYY-MM-DD format
severity - one of: minor, moderate, severe, catastrophic
casualties - number of people killed (use 0 if none)
injuries - number of people injured (use 0 if none)
source_url - URL of a news article about it, or null
type - one of: derailment, collision, fire, bridge_failure, other
mrs - the best matching category from this list:
  Train Derailment
  Train Collision
  Major Structural Failure or Collapse
  Electrocution
  Fire on Railway Premises
  Train Fire
  Platform-Train Interface Incident
  Person Struck by Train
  Impact from Fallen Objects
  Major Escalator or Lift Incident
  Fall from or out of Train
  Environmental or Natural Disaster
  Crowd-Related Incident

Important: use the date the accident happened, not the date an article was published.

Return a JSON array only. No markdown, no extra text. Example:
[{"title":"Example Derailment, France","description":"A passenger train derailed near Lyon killing 4 people and injuring 23 others. The cause was attributed to a track fault. Services were suspended for 48 hours.","location":"Lyon","country":"France","lat":45.75,"lng":4.85,"date":"${dateFrom}","severity":"moderate","casualties":4,"injuries":23,"source_url":null,"type":"derailment","mrs":"Train Derailment"}]`;

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

    // Parse JSON
    let accidents = [];
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('[');
      const end = clean.lastIndexOf(']');
      if (start === -1 || end === -1) throw new Error('No JSON array found');
      accidents = JSON.parse(clean.slice(start, end + 1));
    } catch (e) {
      return res.status(500).json({ error: 'Could not parse AI response', raw: rawText, parseError: e.message });
    }

    if (!Array.isArray(accidents) || !accidents.length) {
      return res.status(200).json({ success: true, inserted: 0, skipped: 0, total: 0, data: [], debug: rawText.slice(0, 1000) });
    }

    // Server-side accuracy filters
    const from = new Date(dateFrom);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);
    const now = new Date();

    const rejectedItems = [];
    const validAccidents = accidents.filter(acc => {
      // Must have a date in YYYY-MM-DD format
      if (!acc.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(acc.date))) {
        rejectedItems.push({ title: acc.title, reason: 'invalid date format', date: acc.date });
        return false;
      }
      const [y, m, d] = String(acc.date).split('-').map(Number);
      const incidentDate = new Date(y, m - 1, d);
      // Must be within requested range
      if (incidentDate < from || incidentDate > toDate) {
        rejectedItems.push({ title: acc.title, reason: 'date out of range', date: acc.date });
        return false;
      }
      // Must not be in the future
      if (incidentDate > now) {
        rejectedItems.push({ title: acc.title, reason: 'date in future', date: acc.date });
        return false;
      }
      // Must have required fields
      if (!acc.title || !acc.country) {
        rejectedItems.push({ title: acc.title, reason: 'missing title or country', date: acc.date });
        return false;
      }
      // Reject (0,0) coordinates
      if (acc.lat === 0 && acc.lng === 0) {
        rejectedItems.push({ title: acc.title, reason: 'zero coordinates', date: acc.date });
        return false;
      }
      return true;
    });

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
      data: insertedRows,
      rejectedDetails: rejectedItems   // visible in browser console for debugging
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
