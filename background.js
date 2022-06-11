// Copyright 2021 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as constants from './constants.js';

chrome.action.onClicked.addListener((tab) => {
  console.log('Toggling extension');
  chrome.tabs.sendMessage(tab.id, { type: constants.toggleMsg });
});

chrome.runtime.onMessage.addListener((req, sender, cb) => {
  // Update the action icon's badge in response to messages from content.js
  // about the updated enabled/disabled state.
  if (req.type === constants.enabledMsg) {
    chrome.action.setBadgeText({ text: '' });
  } else if (req.type === constants.disabledMsg) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#a00' });
  }
});
