'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STORAGE') {
    chrome.storage.local.get(message.keys, (data) => sendResponse(data));
    return true;
  }
  if (message.type === 'SET_STORAGE') {
    chrome.storage.local.set(message.data, () => sendResponse({ ok: true }));
    return true;
  }
});
