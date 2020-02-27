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
  chrome.storage.sync.get(
    [completeTimeoutMsKey, correctTimeoutMsKey, practiceAutoStartKey],
    items => {
      $('complete-timeout-input').value =
        items[completeTimeoutMsKey] || completeTimeoutMsDefault;
      $('correct-timeout-input').value =
        items[correctTimeoutMsKey] || correctTimeoutMsDefault;
      $('practice-auto-start-select').value =
        items[practiceAutoStartKey] || practiceAutoStartDontStart;
    },
  );
}

document.addEventListener('DOMContentLoaded', loadOptions);

$('complete-timeout-input').addEventListener('change', e => {
  saveOption(completeTimeoutMsKey, parseInt(e.target.value));
});
$('correct-timeout-input').addEventListener('change', e => {
  saveOption(correctTimeoutMsKey, parseInt(e.target.value));
});
$('practice-auto-start-select').addEventListener('change', e => {
  saveOption(practiceAutoStartKey, parseInt(e.target.value));
});
