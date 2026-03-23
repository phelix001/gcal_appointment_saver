document.addEventListener('DOMContentLoaded', async () => {
  const providerSelect = document.getElementById('provider');
  const apiKeyInput = document.getElementById('api-key');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('status');
  const keyHint = document.getElementById('key-hint');

  const hints = {
    anthropic: 'Get your key from console.anthropic.com',
    openai: 'Get your key from platform.openai.com/api-keys'
  };

  // Load saved settings
  const settings = await chrome.storage.sync.get(['apiKey', 'provider']);
  if (settings.provider) providerSelect.value = settings.provider;
  if (settings.apiKey) apiKeyInput.value = settings.apiKey;
  keyHint.textContent = hints[providerSelect.value];

  providerSelect.addEventListener('change', () => {
    keyHint.textContent = hints[providerSelect.value];
  });

  const testBtn = document.getElementById('test-btn');

  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const provider = providerSelect.value;

    if (!apiKey) {
      showStatus('Please enter an API key.', 'error');
      return;
    }

    await chrome.storage.sync.set({ apiKey, provider });
    showStatus('Settings saved!', 'success');
  });

  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const provider = providerSelect.value;

    if (!apiKey) {
      showStatus('Please enter an API key first.', 'error');
      return;
    }

    testBtn.disabled = true;
    showStatus('Testing...', 'success');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_API_KEY',
        apiKey,
        provider
      });

      if (response && response.success) {
        showStatus('Key works! API call succeeded.', 'success');
      } else {
        showStatus(response?.error || 'Test failed — unknown error.', 'error');
      }
    } catch (err) {
      showStatus('Could not reach service worker: ' + err.message, 'error');
    }

    testBtn.disabled = false;
  });

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
    statusEl.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    }
  }

  // ==========================================================================
  // Meeting Prep — Google Search
  // ==========================================================================

  const searchCxInput = document.getElementById('google-search-cx');
  const saveSearchBtn = document.getElementById('save-search-btn');
  const searchStatusEl = document.getElementById('search-status');

  // Load saved search settings
  const searchSettings = await chrome.storage.sync.get(['googleSearchCx']);
  if (searchSettings.googleSearchCx) searchCxInput.value = searchSettings.googleSearchCx;

  saveSearchBtn.addEventListener('click', async () => {
    const cx = searchCxInput.value.trim();
    if (!cx) {
      showSearchStatus('Please enter a Search Engine ID.', 'error');
      return;
    }
    await chrome.storage.sync.set({ googleSearchCx: cx });
    showSearchStatus('Search settings saved!', 'success');
  });

  function showSearchStatus(msg, type) {
    searchStatusEl.textContent = msg;
    searchStatusEl.className = `status ${type}`;
    searchStatusEl.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => { searchStatusEl.style.display = 'none'; }, 3000);
    }
  }

  // ==========================================================================
  // Meeting Prep — Exclusion List
  // ==========================================================================

  const DEFAULT_EXCLUDED_CONTACTS = [
    'han le',
    'toan',
    'freedman',
    'josh@sd',
    'i8goodjosh'
  ];

  const excludedTextarea = document.getElementById('excluded-contacts');
  const saveExclusionsBtn = document.getElementById('save-exclusions-btn');
  const resetExclusionsBtn = document.getElementById('reset-exclusions-btn');
  const exclusionStatusEl = document.getElementById('exclusion-status');

  // Load saved exclusion list (or defaults)
  const exclusionSettings = await chrome.storage.sync.get(['excludedContacts']);
  const currentList = exclusionSettings.excludedContacts || DEFAULT_EXCLUDED_CONTACTS;
  excludedTextarea.value = currentList.join('\n');

  saveExclusionsBtn.addEventListener('click', async () => {
    const lines = excludedTextarea.value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    await chrome.storage.sync.set({ excludedContacts: lines });
    showExclusionStatus('Exclusion list saved!', 'success');
  });

  resetExclusionsBtn.addEventListener('click', async () => {
    excludedTextarea.value = DEFAULT_EXCLUDED_CONTACTS.join('\n');
    await chrome.storage.sync.set({ excludedContacts: DEFAULT_EXCLUDED_CONTACTS });
    showExclusionStatus('Reset to defaults.', 'success');
  });

  function showExclusionStatus(msg, type) {
    exclusionStatusEl.textContent = msg;
    exclusionStatusEl.className = `status ${type}`;
    exclusionStatusEl.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => { exclusionStatusEl.style.display = 'none'; }, 3000);
    }
  }
});
