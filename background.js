/**
 * GCal Appointment Saver — Background Service Worker
 * Handles AI API calls for free-text appointment parsing.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PARSE_APPOINTMENT') {
    handleParse(message.text)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'TEST_API_KEY') {
    testApiKey(message.apiKey, message.provider)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function testApiKey(apiKey, provider) {
  if (provider === 'openai') {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`HTTP ${resp.status}: ${err.error?.message || 'Request failed'}`);
    }
    return 'Key works!';
  } else {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }]
      })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`HTTP ${resp.status}: ${err.error?.message || 'Request failed'}`);
    }
    return 'Key works!';
  }
}

async function handleParse(rawText) {
  const settings = await chrome.storage.sync.get(['apiKey', 'provider']);

  if (!settings.apiKey) {
    throw new Error('No API key configured. Right-click the extension icon → Options to set one up.');
  }

  const prompt = buildPrompt(rawText);
  const provider = settings.provider || 'anthropic';

  let aiText;
  if (provider === 'openai') {
    aiText = await callOpenAI(settings.apiKey, prompt);
  } else {
    aiText = await callAnthropic(settings.apiKey, prompt);
  }

  const eventData = parseAIResponse(aiText);
  return { eventData };
}

// --- AI Prompt (duplicated here since service workers can't access content script globals) ---

function buildPrompt(rawText) {
  const today = new Date().toISOString().split('T')[0];
  return `You are an appointment parser. Extract event details from the text below.

Today's date is ${today}. Use this to resolve relative dates like "next Tuesday", "tomorrow", etc.

Return ONLY a JSON object (no markdown, no code fences, no explanation):
{
  "title": "Short descriptive event title",
  "startDate": "YYYY-MM-DD",
  "startTime": "HH:MM (24-hour)",
  "endDate": "YYYY-MM-DD",
  "endTime": "HH:MM (24-hour)",
  "location": "Location or empty string",
  "description": "Brief relevant details"
}

Rules:
- If no end time is given, assume 1 hour after start.
- If no year is given, assume the next occurrence of that date.
- If a timezone is mentioned, note it in the description.
- If the text is too vague for a date/time, set startDate to "UNKNOWN".
- Keep the title short and natural.

Text to parse:
"""
${rawText}
"""`;
}

function parseAIResponse(responseText) {
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);

  if (!parsed.title || !parsed.startDate || !parsed.startTime) {
    throw new Error('AI could not extract event details. Try adding more date/time info.');
  }
  if (parsed.startDate === 'UNKNOWN') {
    throw new Error('Could not determine a date. Please include a date or time.');
  }

  if (!parsed.endDate) parsed.endDate = parsed.startDate;
  if (!parsed.endTime) {
    const [h, m] = parsed.startTime.split(':').map(Number);
    parsed.endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return parsed;
}

// --- API Callers ---

async function callAnthropic(apiKey, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key. Check your Anthropic key in Settings.');
    if (response.status === 429) throw new Error('Rate limited. Wait a moment and try again.');
    throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAI(apiKey, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: 'You are a precise appointment parser. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key. Check your OpenAI key in Settings.');
    if (response.status === 429) throw new Error('Rate limited. Wait a moment and try again.');
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
