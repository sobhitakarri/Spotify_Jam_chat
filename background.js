// Service Worker for Spotify Jam Chat Extension

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Spotify Jam Chat] Extension installed successfully!');
  chrome.storage.local.set({
    nickname: 'Viber_' + Math.floor(1000 + Math.random() * 9000),
    serverUrl: 'http://localhost:3000', // Or public URL e.g. https://your-jam-server.loca.lt
    soundEnabled: true,
    notificationsEnabled: true
  });
});

// Handle messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'UPDATE_UNREAD_COUNT') {
    const count = request.count;
    if (count > 0) {
      chrome.action.setBadgeText({ text: count.toString(), tabId: sender.tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: '#1DB954' });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: sender.tab?.id });
    }
    sendResponse({ status: 'ok' });
  }

  if (request.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['nickname', 'serverUrl', 'soundEnabled', 'notificationsEnabled'], (res) => {
      sendResponse(res);
    });
    return true; // Keep channel open for async response
  }
});
