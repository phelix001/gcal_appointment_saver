/**
 * GCal Appointment Saver — Content Script
 * Injects a paste bar at the top of Google Calendar.
 */

(function () {
  'use strict';

  // Prevent double injection
  if (document.getElementById('gcal-saver-bar')) return;

  // --- Build the bar ---
  const bar = document.createElement('div');
  bar.id = 'gcal-saver-bar';
  bar.innerHTML = `
    <span class="gcal-saver-icon">&#128197;</span>
    <input type="text" class="gcal-saver-input" placeholder="Paste appointment info here (ICS, email text, anything)..." />
    <button class="gcal-saver-btn gcal-saver-btn-add" id="gcal-saver-add">Add</button>
    <span class="gcal-saver-status" id="gcal-saver-status"></span>
    <button class="gcal-saver-close" id="gcal-saver-close" title="Hide bar">&times;</button>
  `;

  // --- Toggle button (when bar is hidden) ---
  const toggle = document.createElement('button');
  toggle.id = 'gcal-saver-toggle';
  toggle.textContent = 'Paste Appointment';

  document.body.appendChild(bar);
  document.body.appendChild(toggle);
  document.body.classList.add('gcal-saver-active');

  // --- Element references ---
  const input = bar.querySelector('.gcal-saver-input');
  const addBtn = document.getElementById('gcal-saver-add');
  const status = document.getElementById('gcal-saver-status');
  const closeBtn = document.getElementById('gcal-saver-close');

  // --- Handle paste: allow multiline paste into the single-line input ---
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    input.value = pasted;
    // Auto-trigger if it looks like ICS data
    if (window.ICSParser.isICS(pasted)) {
      handleAdd();
    }
  });

  // --- Enter key triggers add ---
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  });

  // --- Add button ---
  addBtn.addEventListener('click', handleAdd);

  // --- Close / Toggle ---
  closeBtn.addEventListener('click', () => {
    bar.classList.add('gcal-saver-collapsed');
    document.body.classList.remove('gcal-saver-active');
    toggle.classList.add('visible');
  });

  toggle.addEventListener('click', () => {
    bar.classList.remove('gcal-saver-collapsed');
    document.body.classList.add('gcal-saver-active');
    toggle.classList.remove('visible');
    input.focus();
  });

  // --- Main handler ---
  async function handleAdd() {
    const text = input.value.trim();
    if (!text) {
      showStatus('Paste some appointment info first.', true);
      return;
    }

    addBtn.disabled = true;
    showStatus('Parsing...');

    try {
      let eventData;

      if (window.ICSParser.isICS(text)) {
        // ICS path — instant, no API key needed
        eventData = window.ICSParser.parse(text);
        showStatus('ICS parsed!');
      } else {
        // Free text path — send to AI via background service worker
        showStatus('AI is reading your text...');
        const response = await chrome.runtime.sendMessage({
          type: 'PARSE_APPOINTMENT',
          text: text
        });

        if (!response || !response.success) {
          const errMsg = response?.error || 'No response from extension. Try reloading.';
          showStatus(errMsg, true);
          addBtn.disabled = false;
          return;
        }

        eventData = response.data.eventData;
        showStatus('Parsed!');
      }

      // Generate Google Calendar URL and open it
      const url = window.CalendarURL.generate(eventData);
      window.open(url, '_blank');

      showStatus(`Opening: ${eventData.title}`);
      input.value = '';
    } catch (err) {
      showStatus(err.message || 'Failed to parse. Try again.', true);
    }

    addBtn.disabled = false;
  }

  function showStatus(msg, isError) {
    status.textContent = msg;
    status.className = 'gcal-saver-status' + (isError ? ' error' : '');
    if (!isError) {
      setTimeout(() => { status.textContent = ''; }, 4000);
    }
  }
})();
