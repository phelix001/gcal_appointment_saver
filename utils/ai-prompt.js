/**
 * AI prompt template and response parser for free-text appointment parsing.
 */

window.AIPrompt = {

  /**
   * Build the prompt for the AI model.
   * @param {string} rawText - The user's pasted text
   * @returns {string} The full prompt
   */
  build(rawText) {
    const today = new Date().toISOString().split('T')[0];

    return `You are an appointment parser. Extract event details from the text below.

Today's date is ${today}. Use this to resolve relative dates like "next Tuesday", "tomorrow", etc.

Return ONLY a JSON object (no markdown, no code fences, no explanation):
{
  "title": "Short descriptive event title",
  "startDate": "YYYY-MM-DD",
  "startTime": "HH:MM (24-hour) or UNKNOWN",
  "endDate": "YYYY-MM-DD",
  "endTime": "HH:MM (24-hour) or UNKNOWN",
  "location": "Location or empty string",
  "description": "Brief relevant details"
}

Rules:
- If no start time is explicitly stated, set startTime to "UNKNOWN". Do NOT guess or infer times from phone numbers, addresses, zip codes, or other non-time data.
- If no end time is given and start time is known, assume 1 hour after start.
- If no year is given, assume the next occurrence of that date.
- If a day-of-week and a date are both given (e.g. "Monday 4/6"), use the explicit date (4/6), not the day-of-week, as the authoritative value.
- If a timezone is mentioned, note it in the description.
- If the text is too vague for a date, set startDate to "UNKNOWN".
- Keep the title short and natural.

Text to parse:
"""
${rawText}
"""`;
  },

  /**
   * Parse the AI's response text into a structured event object.
   * @param {string} responseText - Raw AI response
   * @returns {Object} Parsed event data
   */
  parseResponse(responseText) {
    let cleaned = responseText.trim();

    // Strip markdown code fences if the AI added them despite instructions
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.title || !parsed.startDate) {
      throw new Error('AI could not extract event details. Try adding more date/time info.');
    }

    if (parsed.startDate === 'UNKNOWN') {
      throw new Error('Could not determine a date. Please include a date or time.');
    }

    // If no time was found, default to 9:00 AM and note it
    if (!parsed.startTime || parsed.startTime === 'UNKNOWN') {
      parsed.startTime = '09:00';
      parsed.description = (parsed.description || '') +
        (parsed.description ? ' | ' : '') +
        'No time specified — defaulted to 9:00 AM. Adjust as needed.';
    }

    // Default end to 1 hour after start if missing/unknown
    if (!parsed.endDate) parsed.endDate = parsed.startDate;
    if (!parsed.endTime || parsed.endTime === 'UNKNOWN') {
      const [h, m] = parsed.startTime.split(':').map(Number);
      parsed.endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    return parsed;
  }
};
