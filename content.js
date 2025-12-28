console.log('GeoClaude content script loaded on:', window.location.href);
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageContent') {
    sendResponse({
      url: window.location.href,
      title: document.title,
      selection: window.getSelection().toString()
    });
  }
});
