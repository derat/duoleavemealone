// Copyright 2021 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

chrome.browserAction.onClicked.addListener((tab) => {
  console.log('Toggling extension');
  chrome.tabs.sendMessage(tab.id, { type: toggleMsg });
});

chrome.runtime.onMessage.addListener((req, sender, cb) => {
  // Update the browser action icon's badge in response to messages from
  // content.js about the updated enabled/disabled state.
  if (req.type === enabledMsg) {
    chrome.browserAction.setBadgeText({ text: '' });
  } else if (req.type === disabledMsg) {
    chrome.browserAction.setBadgeText({ text: 'OFF' });
    chrome.browserAction.setBadgeBackgroundColor({ color: '#a00' });
  }
});
