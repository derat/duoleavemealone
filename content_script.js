// Copyright 2019 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Returns the <button> element that's used to advance to the next screen.
// The same button is used for correct and incorrect answers, motivational
// messages, etc.
function findNextButton() {
  for (const e of document.getElementsByTagName('button')) {
    if (e.getAttribute('data-test') == 'player-next') return e;
  }
  return null;
}

// Returns true if it looks like the user has just answered a question
// correctly.
function haveCorrectAnswer() {
  for (const e of document.getElementsByTagName('h2')) {
    if (
      e.innerText == 'You are correct' ||
      e.innerText.startsWith('Another correct solution:')
    ) {
      return true;
    }
  }
  return false;
}

// The button isn't there initially, so poll for it until it appears.
const timer = setInterval(() => {
  const b = findNextButton();
  if (!b) return;

  console.log('Found next button');
  clearTimeout(timer);

  new MutationObserver(mutations => {
    let isContinue = false;
    for (const m of mutations) {
      if (m.type == 'characterData' && m.target.data == 'Continue') {
        isContinue = true;
        break;
      }
    }

    if (isContinue && haveCorrectAnswer()) {
      console.log('Continuing after correct answer');
      b.click();
    }
  }).observe(b, {
    subtree: true,
    characterData: true,
  });
}, 100);
