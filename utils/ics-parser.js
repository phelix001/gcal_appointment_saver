/**
 * Parse ICS/vCalendar text into structured event data.
 * Handles standard VCALENDAR/VEVENT format with unfolding of long lines.
 */

// Expose globally for content script (content_scripts don't support ES modules)
window.ICSParser = {

  /**
   * Returns true if the text looks like ICS/vCalendar data.
   */
  isICS(text) {
    const trimmed = text.trim();
    return trimmed.startsWith('BEGIN:VCALENDAR') || trimmed.startsWith('BEGIN:VEVENT');
  },

  /**
   * Parse ICS text and return event data object.
   * Returns: { title, startDate, startTime, endDate, endTime, location, description }
   */
  parse(text) {
    // Unfold long lines (RFC 5545: lines starting with space/tab are continuations)
    const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');

    const lines = unfolded.split(/\r?\n/);

    let title = '';
    let dtstart = '';
    let dtend = '';
    let location = '';
    let description = '';

    for (const line of lines) {
      // Strip parameters (e.g., SUMMARY;LANGUAGE=en-US:value → value)
      if (line.match(/^SUMMARY[;:]/)) {
        title = extractValue(line);
      } else if (line.match(/^DTSTART[;:]/)) {
        dtstart = extractValue(line);
      } else if (line.match(/^DTEND[;:]/)) {
        dtend = extractValue(line);
      } else if (line.match(/^LOCATION[;:]/)) {
        location = extractValue(line);
      } else if (line.match(/^DESCRIPTION[;:]/)) {
        description = extractValue(line);
      }
    }

    if (!dtstart) {
      throw new Error('No DTSTART found in ICS data.');
    }

    const start = parseICSDateTime(dtstart);
    const end = dtend ? parseICSDateTime(dtend) : defaultEnd(start);

    // Clean up ICS escape sequences in text fields
    title = unescapeICS(title);
    location = unescapeICS(location);
    description = cleanDescription(unescapeICS(description));

    return {
      title: title || 'Untitled Event',
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
      location,
      description
    };
  }
};

/**
 * Extract the value part from an ICS property line.
 * Handles properties with parameters: SUMMARY;LANGUAGE=en-US:The Title
 */
function extractValue(line) {
  // Find the first colon that's part of the property:value separator
  // Properties can have params with colons in values like mailto:, so we need
  // to find the colon after all params
  const propMatch = line.match(/^[A-Z-]+([;][^:]*)?:(.*)/s);
  return propMatch ? propMatch[2] : '';
}

/**
 * Parse ICS datetime string.
 * Formats: 20260213T180500Z (UTC), 20260213T180500 (local), 20260213 (all-day)
 */
function parseICSDateTime(dt) {
  // Strip any TZID parameter value that might be left
  const clean = dt.replace(/^.*:/, '') || dt;
  const str = clean.trim();

  if (str.length === 8) {
    // All-day: 20260213
    return {
      date: `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`,
      time: '00:00'
    };
  }

  // 20260213T180500Z or 20260213T180500
  const match = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) {
    throw new Error(`Cannot parse ICS datetime: ${dt}`);
  }

  const [, year, month, day, hour, minute, , isUTC] = match;

  if (isUTC) {
    // Convert UTC to local time
    const utcDate = new Date(Date.UTC(
      parseInt(year), parseInt(month) - 1, parseInt(day),
      parseInt(hour), parseInt(minute)
    ));
    return {
      date: `${utcDate.getFullYear()}-${pad(utcDate.getMonth() + 1)}-${pad(utcDate.getDate())}`,
      time: `${pad(utcDate.getHours())}:${pad(utcDate.getMinutes())}`
    };
  }

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`
  };
}

function defaultEnd(start) {
  const [h, m] = start.time.split(':').map(Number);
  return {
    date: start.date,
    time: `${pad(h + 1)}:${pad(m)}`
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Unescape ICS text values.
 * ICS escapes: \n → newline, \, → comma, \; → semicolon, \\ → backslash
 */
function unescapeICS(text) {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Clean up description for display — trim excessive whitespace and newlines.
 */
function cleanDescription(desc) {
  return desc
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
