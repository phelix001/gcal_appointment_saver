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
    <button class="gcal-saver-btn gcal-saver-btn-prep" id="gcal-saver-prep" title="Meeting Prep Dossiers">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      Prep
    </button>
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
  const prepBtn = document.getElementById('gcal-saver-prep');
  const status = document.getElementById('gcal-saver-status');
  const closeBtn = document.getElementById('gcal-saver-close');

  // Store raw pasted text here since <input type="text"> strips newlines
  let rawPastedText = '';

  // --- Dossier panel ---
  let dossierPanel = null;

  function createDossierPanel() {
    if (dossierPanel) {
      dossierPanel.remove();
    }

    dossierPanel = document.createElement('div');
    dossierPanel.id = 'gcal-dossier-panel';

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    dossierPanel.innerHTML = `
      <div class="dossier-header">
        <div class="dossier-title">Meeting Prep</div>
        <div class="dossier-date">${dateStr}</div>
        <button class="dossier-close" id="dossier-close" title="Close">&times;</button>
      </div>
      <div class="dossier-body" id="dossier-body">
        <div class="dossier-loading-main">
          <div class="dossier-spinner"></div>
          <span>Fetching today's calendar...</span>
        </div>
      </div>
    `;

    document.body.appendChild(dossierPanel);

    // Trigger slide-in animation
    requestAnimationFrame(() => {
      dossierPanel.classList.add('open');
      document.body.classList.add('gcal-dossier-active');
    });

    document.getElementById('dossier-close').addEventListener('click', closeDossierPanel);
  }

  function closeDossierPanel() {
    if (!dossierPanel) return;
    dossierPanel.classList.remove('open');
    document.body.classList.remove('gcal-dossier-active');
    // Remove after transition
    setTimeout(() => {
      if (dossierPanel) {
        dossierPanel.remove();
        dossierPanel = null;
      }
    }, 300);
  }

  function formatEventTime(isoStr) {
    if (!isoStr) return '';
    // Handle all-day events (just a date string)
    if (!isoStr.includes('T')) return 'All day';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function renderEvents(events) {
    const body = document.getElementById('dossier-body');
    if (!body) return;

    let html = '<div class="dossier-section"><div class="dossier-section-title">Today\'s Meetings</div>';
    for (const event of events) {
      const timeStr = formatEventTime(event.start);
      const endStr = formatEventTime(event.end);
      const timeRange = timeStr && endStr ? `${timeStr} — ${endStr}` : timeStr || 'Time TBD';
      const attendeeCount = event.attendees ? event.attendees.filter(a => !a.self).length : 0;
      html += `
        <div class="dossier-event-card">
          <div class="dossier-event-time">${timeRange}</div>
          <div class="dossier-event-title">${escapeHtml(event.title)}</div>
          <div class="dossier-event-attendees">${attendeeCount} attendee${attendeeCount !== 1 ? 's' : ''}</div>
        </div>
      `;
    }
    html += '</div>';
    html += '<div class="dossier-section" id="dossier-people-section"></div>';
    body.innerHTML = html;
  }

  function renderPeopleLoading(people) {
    const section = document.getElementById('dossier-people-section');
    if (!section) return;

    let html = `<div class="dossier-section-title">Attendee Dossiers (${people.length})</div>`;
    for (const person of people) {
      const personId = personKey(person);
      html += `
        <div class="dossier-person-card" id="dossier-person-${personId}">
          <div class="dossier-person-header">
            <div class="dossier-person-name">${escapeHtml(person.name || '(Unknown)')}</div>
            <div class="dossier-person-email">${escapeHtml(person.email)}</div>
            <div class="dossier-person-meetings">Meeting${person.meetings.length > 1 ? 's' : ''}: ${person.meetings.map(escapeHtml).join(', ')}</div>
            <button class="dossier-skip-btn" data-name="${escapeHtml(person.name || '')}" data-email="${escapeHtml(person.email)}" title="Don't dossier this person again">Skip</button>
          </div>
          <div class="dossier-person-body dossier-person-loading">
            <div class="dossier-spinner-sm"></div>
            <span>Researching...</span>
          </div>
        </div>
      `;
    }
    section.innerHTML = html;

    // Attach skip button handlers
    section.querySelectorAll('.dossier-skip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const email = btn.dataset.email;
        addToExclusionList(name || email, btn);
      });
    });
  }

  // --- Exclusion list inline management ---

  async function addToExclusionList(entry, btnEl) {
    const stored = await chrome.storage.sync.get(['excludedContacts']);
    const list = stored.excludedContacts || [];
    if (!list.some(e => e.toLowerCase() === entry.toLowerCase())) {
      list.push(entry);
      await chrome.storage.sync.set({ excludedContacts: list });
    }

    // Hide the person card and show undo bar
    const card = btnEl.closest('.dossier-person-card');
    if (card) {
      card.style.display = 'none';

      const undoBar = document.createElement('div');
      undoBar.className = 'dossier-undo-bar';
      undoBar.innerHTML = `
        <span><strong>${escapeHtml(entry)}</strong> added to skip list</span>
        <button class="dossier-undo-btn">Undo</button>
      `;
      card.parentNode.insertBefore(undoBar, card.nextSibling);

      undoBar.querySelector('.dossier-undo-btn').addEventListener('click', async () => {
        await removeFromExclusionList(entry);
        card.style.display = '';
        undoBar.remove();
      });

      // Auto-dismiss undo after 8 seconds
      setTimeout(() => {
        if (undoBar.parentNode) undoBar.remove();
      }, 8000);
    }
  }

  async function removeFromExclusionList(entry) {
    const stored = await chrome.storage.sync.get(['excludedContacts']);
    const list = (stored.excludedContacts || []).filter(
      e => e.toLowerCase() !== entry.toLowerCase()
    );
    await chrome.storage.sync.set({ excludedContacts: list });
  }

  function renderDossierResult(person, dossier, isError) {
    const personId = personKey(person);
    const card = document.getElementById(`dossier-person-${personId}`);
    if (!card) return;

    const bodyEl = card.querySelector('.dossier-person-body');
    if (!bodyEl) return;

    bodyEl.classList.remove('dossier-person-loading');
    if (isError) {
      bodyEl.classList.add('dossier-person-error');
      bodyEl.innerHTML = `<div class="dossier-error-text">${escapeHtml(dossier)}</div>`;
    } else {
      // Parse contact fields from the dossier text
      const parsed = parseDossierFields(dossier);

      // Update the card header name if we got a better one
      if (parsed.name && parsed.name !== '(Unknown)') {
        const nameEl = card.querySelector('.dossier-person-name');
        if (nameEl) nameEl.textContent = parsed.name;
      }

      bodyEl.innerHTML = `
        <div class="dossier-content">${formatDossier(dossier)}</div>
        <div class="dossier-actions">
          <button class="dossier-add-contact-btn" title="Save to local contacts">+ Add to Contacts</button>
        </div>
      `;

      // Wire up the Add to Contacts button
      const addBtn = bodyEl.querySelector('.dossier-add-contact-btn');
      addBtn.addEventListener('click', () => {
        const contact = {
          email: person.email,
          name: parsed.name || person.name || '',
          title: parsed.title || '',
          phone: parsed.phone || '',
          linkedin: parsed.linkedin || '',
          company: parsed.company || '',
          dossier: dossier
        };
        chrome.runtime.sendMessage({ type: 'SAVE_CONTACT', contact }, (resp) => {
          if (resp && resp.success) {
            addBtn.textContent = 'Saved';
            addBtn.disabled = true;
            addBtn.classList.add('saved');
          }
        });
      });
    }
  }

  /**
   * Parse structured fields from AI dossier text.
   * Looks for **Name**: value, **Title**: value, etc.
   */
  function parseDossierFields(text) {
    const fields = {};
    const extract = (label) => {
      const regex = new RegExp(`\\*\\*${label}\\*\\*\\s*:?\\s*(.+)`, 'i');
      const match = text.match(regex);
      return match ? match[1].trim() : '';
    };

    fields.name = extract('Name');
    fields.title = extract('Title');
    fields.phone = extract('Phone');
    fields.linkedin = extract('LinkedIn');
    fields.company = '';

    // Try to get company from Role & Company or Title field
    const roleCompany = extract('Role & Company') || extract('Role');
    if (roleCompany) {
      // Often formatted as "Title at Company" or "Title, Company"
      const atMatch = roleCompany.match(/(?:at|@)\s+(.+)/i);
      const commaMatch = roleCompany.match(/,\s+(.+)/);
      fields.company = atMatch ? atMatch[1].trim() : (commaMatch ? commaMatch[1].trim() : roleCompany);
    }

    // Clean up LinkedIn — extract just the URL if embedded in text
    if (fields.linkedin) {
      const urlMatch = fields.linkedin.match(/(https?:\/\/[^\s<),]+)/);
      if (urlMatch) fields.linkedin = urlMatch[1];
    }

    return fields;
  }

  function renderDossierError(errorMsg) {
    const body = document.getElementById('dossier-body');
    if (!body) return;
    body.innerHTML = `
      <div class="dossier-error-banner">
        <div class="dossier-error-icon">&#9888;</div>
        <div>${escapeHtml(errorMsg)}</div>
      </div>
    `;
  }

  function renderDossiersComplete() {
    // Update Prep button state
    prepBtn.disabled = false;
    prepBtn.classList.remove('loading');
  }

  function personKey(person) {
    // CSS-safe ID from email
    return (person.email || '').replace(/[^a-zA-Z0-9]/g, '_');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDossier(text) {
    // Convert markdown-ish bold (**text**), bullets, links, and line breaks
    return text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/^- /gm, '&bull; ')
      .replace(/(https?:\/\/[^\s<),]+)/g, '<a href="$1" target="_blank" class="dossier-link">$1</a>')
      .replace(/\n/g, '<br>');
  }

  // --- Prep button handler ---
  prepBtn.addEventListener('click', () => {
    if (prepBtn.disabled) return;

    prepBtn.disabled = true;
    prepBtn.classList.add('loading');

    createDossierPanel();

    chrome.runtime.sendMessage({ type: 'GET_DOSSIERS' }, (response) => {
      if (chrome.runtime.lastError) {
        renderDossierError('Could not reach extension: ' + chrome.runtime.lastError.message);
        prepBtn.disabled = false;
        prepBtn.classList.remove('loading');
      }
      // Results come via separate messages handled below
    });
  });

  // --- Listen for dossier messages from background ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOSSIER_EVENTS') {
      renderEvents(message.events);
    } else if (message.type === 'DOSSIER_PEOPLE') {
      renderPeopleLoading(message.people);
    } else if (message.type === 'DOSSIER_RESULT') {
      renderDossierResult(message.person, message.dossier, message.isError);
    } else if (message.type === 'DOSSIER_ERROR') {
      renderDossierError(message.error);
      prepBtn.disabled = false;
      prepBtn.classList.remove('loading');
    } else if (message.type === 'DOSSIERS_COMPLETE') {
      renderDossiersComplete();
    }
  });

  // --- Handle paste: capture raw text before input strips newlines ---
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    rawPastedText = pasted;
    // Show truncated preview in the input field
    input.value = pasted.replace(/[\r\n]+/g, ' ').substring(0, 500);
    // Auto-trigger if it looks like ICS data
    if (window.ICSParser.isICS(pasted)) {
      handleAdd();
    }
  });

  // Clear raw text when user types manually
  input.addEventListener('input', () => {
    rawPastedText = '';
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
    // Use raw pasted text (preserves newlines) or fall back to input value
    const text = (rawPastedText || input.value).trim();
    if (!text) {
      showStatus('Paste some appointment info first.', true);
      return;
    }

    addBtn.disabled = true;
    showStatus('Parsing...');

    try {
      let eventData;

      if (window.ICSParser.isICS(text)) {
        // ICS path — try client-side parsing first
        try {
          eventData = window.ICSParser.parse(text);
          showStatus('ICS parsed!');
        } catch (icsErr) {
          // ICS parsing failed — fall back to AI
          showStatus('ICS parse failed, sending to AI...');
          eventData = await parseWithAI(text);
        }
      } else {
        // Free text path — send to AI
        showStatus('AI is reading your text...');
        eventData = await parseWithAI(text);
      }

      // Generate Google Calendar URL and open it
      const url = window.CalendarURL.generate(eventData);
      window.open(url, '_blank');

      showStatus(`Opening: ${eventData.title}`);
      input.value = '';
      rawPastedText = '';
    } catch (err) {
      showStatus(err.message || 'Failed to parse. Try again.', true);
    }

    addBtn.disabled = false;
  }

  async function parseWithAI(text) {
    const response = await chrome.runtime.sendMessage({
      type: 'PARSE_APPOINTMENT',
      text: text
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'No response from extension. Try reloading.');
    }

    return response.data.eventData;
  }

  function showStatus(msg, isError) {
    status.textContent = msg;
    status.className = 'gcal-saver-status' + (isError ? ' error' : '');
    if (!isError) {
      setTimeout(() => { status.textContent = ''; }, 4000);
    }
  }
})();
