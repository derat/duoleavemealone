// Copyright 2020 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as constants from './constants.js';

const $ = (id) => document.getElementById(id);

// Map from element ID to corresponding option.
const optionIdKeys = {
  ['complete-timeout-input']: constants.completeTimeoutMsKey,
  ['correct-timeout-input']: constants.correctTimeoutMsKey,
  ['practice-auto-start-select']: constants.practiceAutoStartKey,
  ['skip-correct-checkbox']: constants.skipCorrectKey,
  ['stories-enabled-checkbox']: constants.storiesEnabledKey,
};

// Initialize the UI with option values from storage.
chrome.storage.sync.get(constants.optionKeys, (items) => {
  Object.entries(optionIdKeys).forEach(([id, key]) => {
    const el = $(id);
    const val = key in items ? items[key] : constants.optionDefaults[key];
    if (el.type === 'checkbox') el.checked = !!val;
    else el.value = val;
  });
});

// Save options to storage when they're modified through the UI.
Object.entries(optionIdKeys).forEach(([id, key]) => {
  $(id).addEventListener('change', (e) => {
    const val =
      e.target.type === 'checkbox'
        ? e.target.checked
        : parseInt(e.target.value);
    chrome.storage.sync.set({ [key]: val });
  });
});
