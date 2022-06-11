// Copyright 2022 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Content scripts don't get loaded as modules. This wrapper file imports
// content.js so it can import constants.js. For more discussion, see
// https://stackoverflow.com/a/53033388.
(async () => {
  await import(chrome.runtime.getURL('content.js'));
})();
