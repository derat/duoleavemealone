// Copyright 2020 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

function $(id) {
  return document.getElementById(id);
}

function saveOption(key, value) {
  chrome.storage.sync.set({[key]: value});
}

function loadOptions() {
  chrome.storage.sync.get([practiceAutoStartKey], items => {
    $('practice-auto-start-select').value = items[practiceAutoStartKey] || '0';
  });
}

document.addEventListener('DOMContentLoaded', loadOptions);

$('practice-auto-start-select').addEventListener('change', e => {
  saveOption(practiceAutoStartKey, parseInt(e.target.value));
});
