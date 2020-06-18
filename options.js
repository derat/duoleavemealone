// Copyright 2020 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

function $(id) {
  return document.getElementById(id);
}

// Map from element ID to corresponding option.
const optionIdKeys = {
  ['complete-timeout-input']: completeTimeoutMsKey,
  ['correct-timeout-input']: correctTimeoutMsKey,
  ['practice-auto-start-select']: practiceAutoStartKey,
  ['stories-enabled-checkbox']: storiesEnabledKey,
};

// Initialize the UI with option values from storage.
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(optionKeys, items => {
    Object.entries(optionIdKeys).forEach(([id, key]) => {
      const el = $(id);
      const val = key in items ? items[key] : optionDefaults[key];
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val;
    });
  });
});

// Save options to storage when they're modified through the UI.
Object.entries(optionIdKeys).forEach(([id, key]) => {
  $(id).addEventListener('change', e => {
    const val =
      e.target.type === 'checkbox'
        ? e.target.checked
        : parseInt(e.target.value);
    chrome.storage.sync.set({[key]: val});
  });
});
