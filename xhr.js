// Copyright 2022 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// This script is injected into the main page by content.js to monitor XHRs for
// /sessions, which contains question IDs that are needed to link to discussion
// pages.
//
// For reasons that are unclear to me, console.log() doesn't work in this
// code, which makes debugging super-fun.
(function () {
  // Each match contains a regexp matching URLs passed to open() and the
  // name of the corresponding custom event to emit. It'd be nicer to pass
  // this into the function, but we can't access bound variables here since
  // we're running in the page's context. Receiving matches here via custom
  // events from the content script seems like overkill, at least for now.
  const matches = [{ re: /\/sessions$/, name: 'sessions' }];

  const xhr = XMLHttpRequest.prototype;

  const open = xhr.open;
  xhr.open = function (method, url) {
    this.url = url;
    return open.apply(this, arguments);
  };

  const send = xhr.send;
  xhr.send = function () {
    this.addEventListener('load', () => {
      // We can't directly communicate with the content script from here, so
      // we emit custom events: https://stackoverflow.com/a/19312198
      matches
        .filter((m) => this.url.match(m.re))
        .forEach((m) => {
          document.dispatchEvent(
            new CustomEvent(m.name, { detail: { response: this.response } })
          );
        });
    });
    return send.apply(this, arguments);
  };
})();
