/**
 * GCal Appointment Saver — Background Service Worker
 * Handles AI API calls for free-text appointment parsing.
 */

// Default exclusion list for meeting prep
const DEFAULT_EXCLUDED_CONTACTS = [
  'han le',
  'toan',
  'freedman',
  'josh@sd',
  'i8goodjosh'
];

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

  if (message.type === 'GET_DOSSIERS') {
    handleGetDossiers(sender.tab.id)
      .catch(err => {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'DOSSIER_ERROR',
          error: err.message
        });
      });
    // Respond immediately — results come via separate messages
    sendResponse({ success: true, status: 'started' });
    return true;
  }

  if (message.type === 'GENERATE_DOSSIER') {
    handleGenerateDossier(message.person)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_CALENDAR_EVENTS') {
    fetchTodaysEvents()
      .then(events => sendResponse({ success: true, data: events }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'SAVE_CONTACT') {
    saveContact(message.contact)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'DELETE_CONTACT') {
    deleteContact(message.email)
      .then(() => sendResponse({ success: true }))
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

// =============================================================================
// Meeting Prep / Dossier Feature
// =============================================================================

// Cached OAuth token
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get an OAuth token for Google Calendar API via chrome.identity.launchWebAuthFlow.
 * Works in both Chrome and Edge (getAuthToken is Chrome-only).
 */
async function getCalendarToken() {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const redirectUri = chrome.identity.getRedirectURL();
  const scopes = manifest.oauth2.scopes.join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('prompt', 'consent');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Auth flow failed.'));
          return;
        }
        if (!responseUrl) {
          reject(new Error('No response from auth flow. Try again.'));
          return;
        }

        // Parse access token from the URL fragment
        const hashParams = new URLSearchParams(new URL(responseUrl).hash.substring(1));
        const token = hashParams.get('access_token');
        const expiresIn = parseInt(hashParams.get('expires_in') || '3600', 10);

        if (!token) {
          reject(new Error('No access token in auth response.'));
          return;
        }

        cachedToken = token;
        tokenExpiry = Date.now() + expiresIn * 1000;
        resolve(token);
      }
    );
  });
}

/**
 * Clear cached token (e.g., on 401 errors).
 */
function clearCachedToken() {
  cachedToken = null;
  tokenExpiry = 0;
}

/**
 * Fetch the user's calendar list (all visible calendars).
 */
async function fetchCalendarList(token) {
  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Calendar list API error: ${response.status}`);
  }
  const data = await response.json();
  return (data.items || []).filter(cal => !cal.hidden && cal.selected !== false);
}

/**
 * Fetch today's events from ALL visible Google Calendars.
 * Returns a deduplicated array of event objects with attendees.
 */
async function fetchTodaysEvents(retried = false) {
  const token = await getCalendarToken();

  // Fetch calendar list first
  let calendars;
  try {
    calendars = await fetchCalendarList(token);
  } catch (err) {
    if (err.message.includes('401') && !retried) {
      clearCachedToken();
      return fetchTodaysEvents(true);
    }
    // Fallback: if calendar list fails, try primary only
    console.warn('Calendar list fetch failed, falling back to primary:', err.message);
    calendars = [{ id: 'primary' }];
  }

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime'
  });

  // Fetch events from all calendars in parallel
  const results = await Promise.allSettled(
    calendars.map(cal =>
      fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      ).then(async response => {
        if (!response.ok) {
          if (response.status === 401 && !retried) {
            throw new Error('401');
          }
          return []; // Skip calendars we can't read
        }
        const data = await response.json();
        return (data.items || []).map(event => ({
          id: event.id,
          calendarId: cal.id,
          title: event.summary || '(No title)',
          start: event.start?.dateTime || event.start?.date || '',
          end: event.end?.dateTime || event.end?.date || '',
          attendees: (event.attendees || []).map(a => ({
            name: a.displayName || '',
            email: a.email || '',
            self: a.self || false,
            responseStatus: a.responseStatus || 'needsAction'
          }))
        }));
      })
    )
  );

  // Check for 401 on any calendar — retry once with fresh token
  const got401 = results.some(r => r.status === 'rejected' && r.reason?.message === '401');
  if (got401 && !retried) {
    clearCachedToken();
    return fetchTodaysEvents(true);
  }

  // Merge and deduplicate events across calendars (same event ID = same event)
  const eventMap = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) {
      // Use iCalUID-like dedup: same title + same start time = same event
      const dedupKey = `${event.title}|${event.start}`;
      if (!eventMap.has(dedupKey)) {
        eventMap.set(dedupKey, event);
      } else {
        // Merge attendees from duplicate event entries
        const existing = eventMap.get(dedupKey);
        for (const att of event.attendees) {
          const alreadyHas = existing.attendees.some(a => a.email === att.email);
          if (!alreadyHas) {
            existing.attendees.push(att);
          }
        }
      }
    }
  }

  // Return sorted by start time
  return Array.from(eventMap.values()).sort((a, b) => {
    return new Date(a.start) - new Date(b.start);
  });
}

/**
 * Check if a person (name + email) matches any entry in the exclusion list.
 * Matching rules:
 * - Case insensitive
 * - Partial match on name or email
 */
function isExcluded(person, exclusionList) {
  const nameLC = (person.name || '').toLowerCase();
  const emailLC = (person.email || '').toLowerCase();

  return exclusionList.some(entry => {
    const entryLC = entry.toLowerCase().trim();
    if (!entryLC) return false;
    return nameLC.includes(entryLC) || emailLC.includes(entryLC);
  });
}

/**
 * Main handler for GET_DOSSIERS.
 * Fetches today's events, extracts attendees, filters exclusions,
 * then generates dossiers one by one, pushing results to the tab.
 */
async function handleGetDossiers(tabId) {
  // 1. Fetch today's events
  let events;
  try {
    events = await fetchTodaysEvents();
  } catch (err) {
    chrome.tabs.sendMessage(tabId, { type: 'DOSSIER_ERROR', error: err.message });
    return;
  }

  if (!events || events.length === 0) {
    chrome.tabs.sendMessage(tabId, { type: 'DOSSIER_ERROR', error: 'No events found for today.' });
    return;
  }

  // 2. Send events to the tab for display
  chrome.tabs.sendMessage(tabId, { type: 'DOSSIER_EVENTS', events });

  // 3. Load saved contacts for name lookups
  const savedContacts = (await chrome.storage.local.get(['contacts'])).contacts || {};

  // 4. Extract unique attendees (excluding self)
  const attendeeMap = new Map(); // keyed by email
  for (const event of events) {
    for (const attendee of event.attendees) {
      if (attendee.self) continue;
      const key = attendee.email.toLowerCase();
      // Use saved contact name if available, fall back to Calendar display name
      const saved = savedContacts[key];
      const bestName = (saved && saved.name) ? saved.name : attendee.name;
      if (!attendeeMap.has(key)) {
        attendeeMap.set(key, {
          name: bestName,
          email: attendee.email,
          meetings: [event.title],
          savedContact: saved || null
        });
      } else {
        const existing = attendeeMap.get(key);
        if (!existing.meetings.includes(event.title)) {
          existing.meetings.push(event.title);
        }
        // Use the name if we didn't have one before
        if (!existing.name && attendee.name) {
          existing.name = attendee.name;
        }
      }
    }
  }

  // 4. Load exclusion list
  const stored = await chrome.storage.sync.get(['excludedContacts']);
  const exclusionList = stored.excludedContacts || DEFAULT_EXCLUDED_CONTACTS;

  // 5. Filter out excluded people
  const people = [];
  for (const [, person] of attendeeMap) {
    if (!isExcluded(person, exclusionList)) {
      people.push(person);
    }
  }

  if (people.length === 0) {
    chrome.tabs.sendMessage(tabId, {
      type: 'DOSSIER_ERROR',
      error: 'No attendees to research (all excluded or no external attendees).'
    });
    return;
  }

  // 6. Send the people list so the UI can show loading placeholders
  chrome.tabs.sendMessage(tabId, { type: 'DOSSIER_PEOPLE', people });

  // 7. Generate dossiers one by one
  const settings = await chrome.storage.sync.get(['apiKey', 'provider']);
  if (!settings.apiKey) {
    chrome.tabs.sendMessage(tabId, {
      type: 'DOSSIER_ERROR',
      error: 'No API key configured. Go to extension Settings to add one.'
    });
    return;
  }

  for (const person of people) {
    try {
      // Fetch email history and web search results in parallel
      let emailContext = null;
      let webContext = null;

      const [emailResult, webResult] = await Promise.allSettled([
        fetchEmailContext(person.email),
        webSearchPerson(person)
      ]);

      if (emailResult.status === 'fulfilled') emailContext = emailResult.value;
      else console.warn('Gmail fetch failed for', person.email, emailResult.reason?.message);

      if (webResult.status === 'fulfilled') webContext = webResult.value;
      else console.warn('Web search failed for', person.email, webResult.reason?.message);

      const dossier = await generateDossier(person, settings, emailContext, webContext, person.savedContact);
      chrome.tabs.sendMessage(tabId, {
        type: 'DOSSIER_RESULT',
        person,
        dossier
      });
    } catch (err) {
      chrome.tabs.sendMessage(tabId, {
        type: 'DOSSIER_RESULT',
        person,
        dossier: `Error generating dossier: ${err.message}`,
        isError: true
      });
    }
  }

  // 8. Signal completion
  chrome.tabs.sendMessage(tabId, { type: 'DOSSIERS_COMPLETE' });
}

/**
 * Generate a dossier for a single person using the configured AI API.
 */
async function generateDossier(person, settings, emailContext, webContext, savedContact) {
  const prompt = buildDossierPrompt(person, emailContext, webContext, savedContact);
  const provider = settings.provider || 'anthropic';

  let aiText;
  if (provider === 'openai') {
    aiText = await callOpenAIDossier(settings.apiKey, prompt);
  } else {
    aiText = await callAnthropicDossier(settings.apiKey, prompt);
  }

  return aiText;
}

/**
 * Handle individual GENERATE_DOSSIER requests (callable independently).
 */
async function handleGenerateDossier(person) {
  const settings = await chrome.storage.sync.get(['apiKey', 'provider']);
  if (!settings.apiKey) {
    throw new Error('No API key configured.');
  }
  let emailContext = null;
  let webContext = null;
  try { emailContext = await fetchEmailContext(person.email); } catch (_) {}
  try { webContext = await webSearchPerson(person); } catch (_) {}
  const dossier = await generateDossier(person, settings, emailContext, webContext);
  return { dossier };
}

// =============================================================================
// Gmail Integration — extract contact details from email history
// =============================================================================

/**
 * Fetch recent emails from/to a person and extract signature/contact info.
 * Returns an object with extracted snippets for the AI to analyze.
 */
async function fetchEmailContext(email) {
  const token = await getCalendarToken(); // same OAuth token covers Gmail scope

  // Search for recent emails from this person (last 10, most recent first)
  const query = encodeURIComponent(`from:${email}`);
  const searchUrl = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=5`;

  const searchResp = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!searchResp.ok) {
    throw new Error(`Gmail search failed: ${searchResp.status}`);
  }

  const searchData = await searchResp.json();
  const messageIds = (searchData.messages || []).map(m => m.id);

  if (messageIds.length === 0) {
    return null; // No emails found from this person
  }

  // Fetch the most recent 3 emails (full content for signature extraction)
  const emails = [];
  for (const msgId of messageIds.slice(0, 3)) {
    try {
      const msgResp = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!msgResp.ok) continue;
      const msgData = await msgResp.json();

      // Extract headers
      const headers = msgData.payload?.headers || [];
      const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const fromHeader = getHeader('From');
      const subject = getHeader('Subject');
      const date = getHeader('Date');

      // Extract plain text body
      const body = extractPlainText(msgData.payload);

      // Extract just the signature portion (last ~20 lines typically)
      const signature = extractSignature(body);

      emails.push({
        from: fromHeader,
        subject,
        date,
        signature,
        // Include a brief snippet of the body for context (first 300 chars)
        snippet: body.substring(0, 300)
      });
    } catch (_) {
      continue;
    }
  }

  if (emails.length === 0) return null;

  return { emails, totalFound: messageIds.length };
}

/**
 * Recursively extract plain text from a Gmail message payload.
 */
function extractPlainText(payload) {
  if (!payload) return '';

  // Direct text/plain part
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return base64UrlDecode(payload.body.data);
  }

  // Multipart — recurse into parts
  if (payload.parts) {
    for (const part of payload.parts) {
      // Prefer text/plain
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return base64UrlDecode(part.body.data);
      }
    }
    // If no text/plain, try text/html and strip tags
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = base64UrlDecode(part.body.data);
        return stripHtml(html);
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }

  return '';
}

/**
 * Decode base64url-encoded string (Gmail API format).
 */
function base64UrlDecode(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      atob(base64).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
  } catch (_) {
    try { return atob(base64); } catch (__) { return ''; }
  }
}

/**
 * Strip HTML tags to get plain text.
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract email signature from the bottom of an email body.
 * Looks for common signature delimiters and grabs the last block.
 */
function extractSignature(body) {
  if (!body) return '';

  const lines = body.split('\n');

  // Common signature delimiters
  const sigDelimiters = ['--', '---', '—', 'Best,', 'Regards,', 'Thanks,', 'Cheers,',
    'Best regards,', 'Kind regards,', 'Sincerely,', 'Thank you,', 'Warm regards,',
    'Sent from my', 'Get Outlook'];

  // Find the last delimiter and grab everything after it
  let sigStart = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    const trimmed = lines[i].trim();
    if (sigDelimiters.some(d => trimmed.startsWith(d))) {
      sigStart = i;
      break;
    }
  }

  if (sigStart >= 0) {
    return lines.slice(sigStart, Math.min(sigStart + 20, lines.length)).join('\n').trim();
  }

  // Fallback: just return last 15 lines (often contains signature)
  return lines.slice(Math.max(0, lines.length - 15)).join('\n').trim();
}

// =============================================================================
// Web Search — Google the email address for public info
// =============================================================================

/**
 * Search for a person by their email address and name using web search.
 * Tries Google first, falls back to DuckDuckGo.
 * Returns an array of {title, snippet, url} results.
 */
async function webSearchPerson(person) {
  // Extract org name from email domain (arbitrum.foundation → Arbitrum, tangem.com → Tangem)
  const domain = person.email.split('@')[1] || '';
  const orgName = domain.split('.')[0]; // first part of domain
  const orgNameClean = orgName.charAt(0).toUpperCase() + orgName.slice(1); // capitalize

  // Extract first name (even partial names are useful for uncommon ones)
  const firstName = (person.name || '').split(/\s+/)[0];

  // Try to extract a fuller name from meeting titles
  let fullNameFromEvent = '';
  if (person.meetings && person.meetings.length > 0) {
    const meetingText = person.meetings.join(' ');
    // Look for the person's first name followed by what looks like a last name
    if (firstName) {
      const nameInTitle = meetingText.match(new RegExp(firstName + '\\s+([A-Z][a-z]+)', 'i'));
      if (nameInTitle) {
        fullNameFromEvent = firstName + ' ' + nameInTitle[1];
      }
    }
  }

  const bestName = fullNameFromEvent || person.name || firstName;

  const queries = [
    `"${person.email}"`,  // Exact email match — most precise
  ];

  // LinkedIn site-search — Google snippets for LinkedIn contain full name + title
  // This is the highest-value query for building dossiers
  if (bestName) {
    queries.push(`site:linkedin.com/in/ ${bestName} ${orgNameClean}`);
  } else if (firstName) {
    queries.push(`site:linkedin.com/in/ ${firstName} ${orgNameClean}`);
  }

  // Also try the email on LinkedIn (some profiles are indexed by email)
  queries.push(`site:linkedin.com "${person.email}"`);

  // Broader LinkedIn search without site: (sometimes finds LinkedIn in other contexts)
  if (firstName && orgNameClean) {
    queries.push(`${firstName} ${orgNameClean} linkedin`);
  }

  // General name + org search for non-LinkedIn presence (conference talks, articles, etc.)
  if (bestName && orgNameClean) {
    queries.push(`"${bestName}" ${orgNameClean}`);
  } else if (firstName && orgNameClean) {
    queries.push(`${firstName} ${orgNameClean}`);
  }

  const allResults = [];

  for (const query of queries) {
    try {
      const results = await googleSearch(query);
      if (results && results.length > 0) {
        allResults.push(...results);
        continue;
      }
    } catch (_) {}

    // Fallback: try DuckDuckGo
    try {
      const results = await duckDuckGoSearch(query);
      if (results && results.length > 0) {
        allResults.push(...results);
      }
    } catch (_) {}
  }

  if (allResults.length === 0) return null;

  // Deduplicate by URL
  const seen = new Set();
  const unique = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Prioritize LinkedIn results — they have the richest professional data
  const linkedin = unique.filter(r => r.url && r.url.includes('linkedin.com'));
  const other = unique.filter(r => !r.url || !r.url.includes('linkedin.com'));
  const sorted = [...linkedin, ...other];

  return { results: sorted.slice(0, 10) };
}

/**
 * Search using Google Custom Search JSON API.
 * Returns clean structured results. Free tier: 100 queries/day.
 */
async function googleSearch(query) {
  const stored = await chrome.storage.sync.get(['googleSearchApiKey', 'googleSearchCx']);
  const apiKey = stored.googleSearchApiKey || 'AIzaSyCOZKP_l2cT5Y6nvOQgnoWAfCYrP4eiX3A';
  const cx = stored.googleSearchCx;

  if (!cx) {
    console.warn('No Google Custom Search Engine ID configured');
    return null;
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx: cx,
    q: query,
    num: '5'
  });

  const resp = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`);

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.warn('Google Custom Search failed:', resp.status, err.error?.message);
    return null;
  }

  const data = await resp.json();
  const items = data.items || [];

  return items.map(item => ({
    title: item.title || '',
    url: item.link || '',
    snippet: item.snippet || ''
  }));
}

/**
 * Fallback: Search DuckDuckGo Lite (simplest HTML, most parseable).
 */
async function duckDuckGoSearch(query) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html'
    }
  });

  if (!resp.ok) return null;
  const html = await resp.text();

  // DuckDuckGo Lite uses simple table-based layout
  const results = [];

  // Extract links and their text from result rows
  const linkRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*class="result-link"[^>]*>(.*?)<\/a>/gi;
  const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>(.*?)<\/td>/gi;

  const links = [];
  const titles = [];
  const snippets = [];

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push(match[1]);
    titles.push(stripHtml(match[2]).trim());
  }

  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]).trim());
  }

  // If lite parsing fails, try the standard HTML format
  if (links.length === 0) {
    const altLinkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    const altSnippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

    while ((match = altLinkRegex.exec(html)) !== null) {
      const rawUrl = match[1];
      const actualUrl = rawUrl.includes('uddg=')
        ? decodeURIComponent(rawUrl.replace(/.*uddg=/, '').replace(/&.*/, ''))
        : rawUrl;
      links.push(actualUrl);
      titles.push(stripHtml(match[2]).trim());
    }

    while ((match = altSnippetRegex.exec(html)) !== null) {
      snippets.push(stripHtml(match[1]).trim());
    }
  }

  for (let i = 0; i < Math.min(links.length, 5); i++) {
    results.push({
      title: titles[i] || '',
      url: links[i] || '',
      snippet: snippets[i] || ''
    });
  }

  return results.length > 0 ? results : null;
}

/**
 * Build the AI prompt for a person dossier, enriched with email data.
 */
function buildDossierPrompt(person, emailContext, webContext, savedContact) {
  let savedSection = '';

  if (savedContact && savedContact.dossier) {
    savedSection = `\n\nPREVIOUSLY SAVED DOSSIER (from ${savedContact.lastUpdated || 'earlier'}):\n${savedContact.dossier}\n\nUse this as a baseline — update or correct it with any new information from emails or web search. Keep all previously known details unless contradicted.`;
  } else if (savedContact) {
    savedSection = `\n\nSaved contact info: Name: ${savedContact.name || '?'}, Title: ${savedContact.title || '?'}, Company: ${savedContact.company || '?'}, Phone: ${savedContact.phone || '?'}, LinkedIn: ${savedContact.linkedin || '?'}`;
  }

  let emailSection = '';

  if (emailContext && emailContext.emails.length > 0) {
    emailSection = `\n\nI found ${emailContext.totalFound} email(s) from this person in my inbox. Here are extracts from the most recent ones:\n`;

    for (const email of emailContext.emails) {
      emailSection += `\n--- Email ---\nFrom: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n`;
      if (email.signature) {
        emailSection += `Signature block:\n${email.signature}\n`;
      }
      if (email.snippet) {
        emailSection += `Preview: ${email.snippet}\n`;
      }
    }

    emailSection += `\nIMPORTANT: Extract any contact details from the email signatures above — full name, job title, company, phone number(s), LinkedIn, address. These are REAL data from actual emails, so use them with high confidence.`;
  }

  let webSection = '';

  if (webContext && webContext.results.length > 0) {
    webSection = `\n\nWeb search results for this person's email/name:\n`;
    for (const result of webContext.results) {
      webSection += `\n- ${result.title}\n  URL: ${result.url}\n`;
      if (result.snippet) {
        webSection += `  Snippet: ${result.snippet}\n`;
      }
    }
    webSection += `\nCRITICAL: Use these web results to build the dossier:
1. If any URL contains linkedin.com/in/, that IS their LinkedIn profile — use it directly as the LinkedIn field. The title/snippet from that result usually contains their FULL NAME and JOB TITLE — extract and use them.
2. Google snippets for LinkedIn profiles typically show: "FirstName LastName - Title - Company | LinkedIn" — parse this pattern.
3. Also note conference talks, podcasts, YouTube videos, articles, GitHub profiles, or Twitter/X accounts found.
4. Web search data is REAL and current — prefer it over guessing.`;
  }

  return `You are preparing a brief professional dossier for a meeting prep. Given the following person's information, provide a concise professional summary.

Person: ${person.name || '(name unknown)'}
Email: ${person.email}
Calendar event(s) they're attending: ${person.meetings.join(' | ')}${savedSection}${emailSection}${webSection}

NOTE: The calendar event title may contain this person's full name — use it if their display name is incomplete.

Provide a brief dossier in this format:
- **Name**: Full name (from email signature if available)
- **Title**: Job title and company
- **Phone**: Phone number(s) if found in signatures
- **LinkedIn**: If found in signature, include the full URL. If NOT in signature but you have their full name and company, generate a search URL in this exact format: https://www.linkedin.com/search/results/all/?keywords=FIRSTNAME%20LASTNAME%20COMPANY (URL-encode the values). Always include a LinkedIn line.
- **Role & Company**: Current position and company (from signature or email domain)
- **Background**: Brief professional background (2-3 sentences max)
- **Notable**: Any notable achievements, publications, or public presence
- **Meeting Context**: Any relevant context that might be useful for a meeting

If email signature data is available, ALWAYS prefer it over guessing. If you have no reliable information about a field, omit it rather than guessing. Always include a LinkedIn line — either the real URL from their signature or a search URL constructed from their name and company.

Keep it concise — this is a quick reference, not a full biography.`;
}

/**
 * Call Anthropic API for dossier generation (uses higher max_tokens than parsing).
 */
async function callAnthropicDossier(apiKey, prompt) {
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
    if (response.status === 401) throw new Error('Invalid API key.');
    if (response.status === 429) throw new Error('Rate limited. Wait a moment.');
    throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

/**
 * Call OpenAI API for dossier generation.
 */
async function callOpenAIDossier(apiKey, prompt) {
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
        { role: 'system', content: 'You are a professional research assistant preparing brief dossiers for meeting prep.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Invalid API key.');
    if (response.status === 429) throw new Error('Rate limited. Wait a moment.');
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// =============================================================================
// Contact Book — local storage for enriched contact info
// =============================================================================

/**
 * Save a contact to local storage, keyed by email.
 */
async function saveContact(contact) {
  const stored = await chrome.storage.local.get(['contacts']);
  const contacts = stored.contacts || {};
  contacts[contact.email.toLowerCase()] = {
    name: contact.name || '',
    title: contact.title || '',
    phone: contact.phone || '',
    linkedin: contact.linkedin || '',
    company: contact.company || '',
    dossier: contact.dossier || '',
    lastUpdated: new Date().toISOString().split('T')[0]
  };
  await chrome.storage.local.set({ contacts });
}

/**
 * Delete a contact from local storage.
 */
async function deleteContact(email) {
  const stored = await chrome.storage.local.get(['contacts']);
  const contacts = stored.contacts || {};
  delete contacts[email.toLowerCase()];
  await chrome.storage.local.set({ contacts });
}

/**
 * Look up a contact by email. Returns the contact object or null.
 */
async function lookupContact(email) {
  const stored = await chrome.storage.local.get(['contacts']);
  const contacts = stored.contacts || {};
  return contacts[email.toLowerCase()] || null;
}
