chrome.storage.local.get(['apiKey'], (result) => {
  const statusEl = document.getElementById('apiKeyStatus');
  if (result.apiKey && result.apiKey.startsWith('sk-ant-')) {
    statusEl.textContent = 'Configured'; statusEl.className = 'status-value ready';
  } else { statusEl.textContent = 'Not configured'; statusEl.className = 'status-value missing'; }
});
navigator.permissions.query({ name: 'geolocation' }).then((result) => {
  const locEl = document.getElementById('locationStatus');
  if (result.state === 'granted') { locEl.textContent = 'Granted'; locEl.className = 'status-value ready'; }
  else if (result.state === 'prompt') { locEl.textContent = 'Prompt'; locEl.className = 'status-value'; }
  else { locEl.textContent = 'Denied'; locEl.className = 'status-value missing'; }
});
document.getElementById('openSidePanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ windowId: tab.windowId }); window.close();
});
document.getElementById('openSettings').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await chrome.storage.local.set({ view: 'settings' }); window.close();
});
