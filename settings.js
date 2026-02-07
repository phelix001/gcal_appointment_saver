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

  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const provider = providerSelect.value;

    if (!apiKey) {
      showStatus('Please enter an API key.', 'error');
      return;
    }

    // Soft validation — warn but still save
    if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
      showStatus('Saved! Note: Anthropic keys usually start with "sk-ant-".', 'warning');
    } else if (provider === 'openai' && !apiKey.startsWith('sk-')) {
      showStatus('Saved! Note: OpenAI keys usually start with "sk-".', 'warning');
    }

    await chrome.storage.sync.set({ apiKey, provider });

    if (!statusEl.classList.contains('warning')) {
      showStatus('Settings saved!', 'success');
    }
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
