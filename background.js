console.log('GeoClaude extension loaded');

chrome.runtime.onInstalled.addListener((details) => {
  console.log('GeoClaude installed:', details.reason);
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage?.();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getLocation') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => ({ url: window.location.href, title: document.title })
      }, (results) => { sendResponse(results?.[0]?.result); });
    });
    return true;
  }
});
