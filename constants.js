// Copyright 2020 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Option keys. Used both for chrome.storage.sync and options object.
const completeTimeoutMsKey = 'completeTimeoutMs';
const correctTimeoutMsKey = 'correctTimeoutMs';
const practiceAutoStartKey = 'practiceAutoStart';
const skipCorrectKey = 'skipCorrect';
const storiesEnabledKey = 'storiesEnabled';

// Values for |practiceAutoStartKey|.
const practiceAutoStartDontStart = 0;
const practiceAutoStartTimed = 1;
const practiceAutoStartUntimed = 2;

// Default values for options.
const optionDefaults = {
  [completeTimeoutMsKey]: 3000,
  [correctTimeoutMsKey]: 2000,
  [practiceAutoStartKey]: practiceAutoStartDontStart,
  [skipCorrectKey]: true,
  [storiesEnabledKey]: true,
};

// All option keys.
const optionKeys = Object.keys(optionDefaults);
