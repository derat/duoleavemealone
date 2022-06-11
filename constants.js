// Copyright 2020 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Option keys. Used both for chrome.storage.sync and options object.
export const completeTimeoutMsKey = 'completeTimeoutMs';
export const correctTimeoutMsKey = 'correctTimeoutMs';
export const practiceAutoStartKey = 'practiceAutoStart';
export const skipCorrectKey = 'skipCorrect';
export const storiesEnabledKey = 'storiesEnabled';

// Values for |practiceAutoStartKey|.
export const practiceAutoStartDontStart = 0;
export const practiceAutoStartTimed = 1;
export const practiceAutoStartUntimed = 2;

// Default values for options.
export const optionDefaults = {
  [completeTimeoutMsKey]: 3000,
  [correctTimeoutMsKey]: 2000,
  [practiceAutoStartKey]: practiceAutoStartDontStart,
  [skipCorrectKey]: true,
  [storiesEnabledKey]: true,
};

// All option keys.
export const optionKeys = Object.keys(optionDefaults);

// 'type' property values for messages sent between background.js and
// content.js.
export const toggleMsg = 'duoleavemealone_toggle';
export const enabledMsg = 'duoleavemealone_enabled';
export const disabledMsg = 'duoleavemealone_disabled';
