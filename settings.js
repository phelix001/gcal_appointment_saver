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
});
