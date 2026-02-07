/**
 * Generate a Google Calendar "create event" URL from parsed event data.
 */

window.CalendarURL = {

  /**
   * Takes event data and returns a Google Calendar template URL.
   * @param {Object} eventData - { title, startDate, startTime, endDate, endTime, location, description }
   * @returns {string} Google Calendar URL
   */
  generate(eventData) {
    const { title, startDate, startTime, endDate, endTime, location, description } = eventData;

    // Format: YYYYMMDDTHHMMSS (no Z = user's local timezone)
    const start = formatDateTime(startDate, startTime);
    const end = formatDateTime(endDate, endTime);

    const params = new URLSearchParams();
    params.set('action', 'TEMPLATE');
    params.set('text', title);
    params.set('dates', `${start}/${end}`);

    if (description) {
      params.set('details', description);
    }
    if (location) {
      params.set('location', location);
    }

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }
};

/**
 * Format date and time strings into Google Calendar datetime format.
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {string} timeStr - "HH:MM"
 * @returns {string} "YYYYMMDDTHHMMSS"
 */
function formatDateTime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-');
  const [hour, minute] = timeStr.split(':');
  return `${year}${month}${day}T${hour}${minute}00`;
}
