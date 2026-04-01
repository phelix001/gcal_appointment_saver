/**
 * Google Contacts Saver — Content Script
 * Injects a paste bar at the top of Google Contacts for quick contact creation.
 */

(function () {
  'use strict';

  // Prevent double injection
  if (document.getElementById('gcontact-saver-bar')) return;

  // --- Build the bar ---
  const bar = document.createElement('div');
  bar.id = 'gcontact-saver-bar';
  bar.innerHTML = `
    <span class="gcontact-saver-icon">&#128100;</span>
    <input type="text" class="gcontact-saver-input" placeholder="Paste contact info here (name, email, phone, anything)..." />
    <button class="gcontact-saver-btn gcontact-saver-btn-add" id="gcontact-saver-add">Add Contact</button>
    <span class="gcontact-saver-status" id="gcontact-saver-status"></span>
    <button class="gcontact-saver-close" id="gcontact-saver-close" title="Hide bar">&times;</button>
  `;

  // --- Toggle button (when bar is hidden) ---
  const toggle = document.createElement('button');
  toggle.id = 'gcontact-saver-toggle';
  toggle.textContent = 'Paste Contact';

  document.body.appendChild(bar);
  document.body.appendChild(toggle);
  document.body.classList.add('gcontact-saver-active');

  // --- Element references ---
  const input = bar.querySelector('.gcontact-saver-input');
  const addBtn = document.getElementById('gcontact-saver-add');
  const status = document.getElementById('gcontact-saver-status');
  const closeBtn = document.getElementById('gcontact-saver-close');

  // Store raw pasted text (input type=text strips newlines)
  let rawPastedText = '';

  // --- Handle paste ---
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    rawPastedText = pasted;
    input.value = pasted.replace(/[\r\n]+/g, ' ').substring(0, 500);
    // Auto-trigger if it looks like a vCard
    if (window.VCFParser.isVCF(pasted)) {
      handleAdd();
    }
  });

  input.addEventListener('input', () => { rawPastedText = ''; });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  });

  addBtn.addEventListener('click', handleAdd);

  // --- Close / Toggle ---
  closeBtn.addEventListener('click', () => {
    bar.classList.add('gcontact-saver-collapsed');
    document.body.classList.remove('gcontact-saver-active');
    toggle.classList.add('visible');
  });

  toggle.addEventListener('click', () => {
    bar.classList.remove('gcontact-saver-collapsed');
    document.body.classList.add('gcontact-saver-active');
    toggle.classList.remove('visible');
    input.focus();
  });

  // --- Main handler ---
  async function handleAdd() {
    const text = (rawPastedText || input.value).trim();
    if (!text) {
      showStatus('Paste some contact info first.', true);
      return;
    }

    addBtn.disabled = true;
    showStatus('Parsing...');

    try {
      let contactData;

      if (window.VCFParser.isVCF(text)) {
        try {
          contactData = window.VCFParser.parse(text);
          showStatus('vCard parsed!');
        } catch (vcfErr) {
          showStatus('vCard parse failed, sending to AI...');
          contactData = await parseWithAI(text);
        }
      } else {
        showStatus('AI is reading your text...');
        contactData = await parseWithAI(text);
      }

      // Store parsed data and attempt to fill the new contact form
      await chrome.storage.local.set({ pendingContact: contactData });

      if (isNewContactPage()) {
        // Already on /new — fill the form directly
        const filled = await fillContactForm(contactData);
        if (filled > 0) {
          showStatus(`Filled ${filled} field(s) — review and save!`);
        } else {
          showContactCard(contactData);
          showStatus('Could not auto-fill. See parsed info card →');
        }
        await chrome.storage.local.remove('pendingContact');
      } else {
        // Navigate to new contact page — script will re-inject and pick up pendingContact
        showStatus('Opening new contact form...');
        window.location.href = 'https://contacts.google.com/new';
      }

      input.value = '';
      rawPastedText = '';
    } catch (err) {
      showStatus(err.message || 'Failed to parse. Try again.', true);
    }

    addBtn.disabled = false;
  }

  async function parseWithAI(text) {
    const response = await chrome.runtime.sendMessage({
      type: 'PARSE_CONTACT',
      text: text
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'No response from extension. Try reloading.');
    }

    return response.data.contactData;
  }

  // --- Check for pending contact data on page load ---
  async function checkPendingContact() {
    if (!isNewContactPage()) return;

    const { pendingContact } = await chrome.storage.local.get('pendingContact');
    if (!pendingContact) return;

    // Wait for the form to render (Google Contacts is a SPA)
    showStatus('Filling contact form...');
    await waitForForm();

    const filled = await fillContactForm(pendingContact);
    await chrome.storage.local.remove('pendingContact');

    if (filled > 0) {
      showStatus(`Filled ${filled} field(s) — review and save!`);
    } else {
      showContactCard(pendingContact);
      showStatus('Could not auto-fill. See parsed info card →');
    }
  }

  function isNewContactPage() {
    return window.location.pathname.includes('/new') ||
           window.location.pathname.includes('/person/create');
  }

  // --- Form filling ---

  /**
   * Wait for the Google Contacts form to render.
   * Returns when at least one input is found, or times out after 8s.
   */
  function waitForForm() {
    return new Promise((resolve) => {
      const selectors = 'input[aria-label="First name"], input[aria-label="Name"], input[placeholder*="irst"]';
      if (document.querySelector(selectors)) {
        // Small delay to let remaining fields render
        setTimeout(resolve, 500);
        return;
      }

      const observer = new MutationObserver(() => {
        if (document.querySelector(selectors)) {
          observer.disconnect();
          setTimeout(resolve, 500);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Timeout after 8 seconds
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 8000);
    });
  }

  /**
   * Attempt to fill form fields using multiple selector strategies.
   * Returns the number of fields successfully filled.
   */
  async function fillContactForm(data) {
    const fieldMap = [
      {
        value: data.firstName,
        selectors: [
          'input[aria-label="First name"]',
          'input[aria-label="Name"]',
          'input[placeholder="First name"]',
          'input[placeholder="Name"]'
        ]
      },
      {
        value: data.lastName,
        selectors: [
          'input[aria-label="Last name"]',
          'input[aria-label="Surname"]',
          'input[placeholder="Last name"]',
          'input[placeholder="Surname"]'
        ]
      },
      {
        value: data.email,
        selectors: [
          'input[aria-label="Email"]',
          'input[type="email"]',
          'input[placeholder="Email"]'
        ]
      },
      {
        value: data.phone,
        selectors: [
          'input[aria-label="Phone"]',
          'input[type="tel"]',
          'input[placeholder="Phone"]'
        ]
      },
      {
        value: data.organization,
        selectors: [
          'input[aria-label="Company"]',
          'input[aria-label="Organization"]',
          'input[placeholder="Company"]',
          'input[placeholder="Organization"]'
        ]
      },
      {
        value: data.title,
        selectors: [
          'input[aria-label="Title"]',
          'input[aria-label="Job title"]',
          'input[placeholder="Title"]',
          'input[placeholder="Job title"]'
        ]
      },
      {
        value: data.notes,
        selectors: [
          'textarea[aria-label="Notes"]',
          'textarea[aria-label="Note"]',
          'textarea[placeholder="Notes"]',
          'textarea'
        ]
      },
      {
        value: data.address,
        selectors: [
          'input[aria-label="Address"]',
          'textarea[aria-label="Address"]',
          'input[placeholder="Address"]'
        ]
      },
      {
        value: data.website,
        selectors: [
          'input[aria-label="Website"]',
          'input[aria-label="URL"]',
          'input[placeholder="Website"]'
        ]
      }
    ];

    let filled = 0;

    for (const field of fieldMap) {
      if (!field.value) continue;

      for (const selector of field.selectors) {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          simulateInput(el, field.value);
          filled++;
          // Small delay between fields to let the SPA react
          await sleep(100);
          break;
        }
      }
    }

    return filled;
  }

  /**
   * Simulate realistic user input on an element.
   */
  function simulateInput(el, value) {
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));

    // Use native setter to bypass framework getters
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function isVisible(el) {
    return el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // --- Fallback: show parsed contact as a card ---

  function showContactCard(data) {
    // Remove existing card
    const existing = document.getElementById('gcontact-saver-card');
    if (existing) existing.remove();

    const fields = [
      { label: 'Name', value: [data.firstName, data.lastName].filter(Boolean).join(' ') },
      { label: 'Email', value: data.email },
      { label: 'Phone', value: data.phone },
      { label: 'Org', value: data.organization },
      { label: 'Title', value: data.title },
      { label: 'Address', value: data.address },
      { label: 'Website', value: data.website },
      { label: 'Notes', value: data.notes }
    ].filter(f => f.value);

    const card = document.createElement('div');
    card.id = 'gcontact-saver-card';
    card.innerHTML = `
      <div class="gcontact-card-header">
        <h3>Parsed Contact</h3>
        <button class="gcontact-card-close" title="Close">&times;</button>
      </div>
      <div class="gcontact-card-body">
        ${fields.map(f => `
          <div class="gcontact-card-row">
            <span class="gcontact-card-label">${f.label}</span>
            <span class="gcontact-card-value">${escapeHtml(f.value)}</span>
          </div>
        `).join('')}
      </div>
      <div class="gcontact-card-actions">
        <button class="gcontact-card-btn-copy">Copy All</button>
        <button class="gcontact-card-btn-create">Try Fill Again</button>
      </div>
    `;

    document.body.appendChild(card);

    card.querySelector('.gcontact-card-close').addEventListener('click', () => card.remove());

    card.querySelector('.gcontact-card-btn-copy').addEventListener('click', () => {
      const text = fields.map(f => `${f.label}: ${f.value}`).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        showStatus('Copied to clipboard!');
      });
    });

    card.querySelector('.gcontact-card-btn-create').addEventListener('click', async () => {
      card.remove();
      const filled = await fillContactForm(data);
      if (filled > 0) {
        showStatus(`Filled ${filled} field(s) — review and save!`);
      } else {
        showStatus('Still could not find form fields. Fill manually from the card.', true);
        showContactCard(data);
      }
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showStatus(msg, isError) {
    status.textContent = msg;
    status.className = 'gcontact-saver-status' + (isError ? ' error' : '');
    if (!isError) {
      setTimeout(() => { status.textContent = ''; }, 5000);
    }
  }

  // --- Init: check for pending contact on load ---
  checkPendingContact();
})();
