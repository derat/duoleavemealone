// Copyright 2019 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Finds the first element of type |tagName| for which |f| returns true.
function findElement(tagName, f) {
  for (const e of document.getElementsByTagName(tagName)) {
    if (f(e)) return e;
  }
  return null;
}

// Returns true if it looks like the user has just answered a question
// correctly.
function answeredCorrectly() {
  return !!findElement(
    'h2',
    e =>
      e.innerText == 'You are correct' ||
      e.innerText.startsWith('Another correct solution:') ||
      e.innerText.startsWith('Pay attention to the accents.'),
  );
}

// Returns true if a motivational screen (e.g. Duolingo saying "Excellent!") is
// shown.
function motivationShown() {
  // This is pretty crappy, but I can't find any other way to match it.
  // Hardcoding all of the messages doesn't seem great, and I don't see any
  // other attributes that can be used to find this.
  return !!findElement('div', e => {
    const img = getComputedStyle(e)['background-image'];
    return img && img.indexOf('/owls/') != -1;
  });
}

// Returns true if it looks like a lesson-complete screen is being displayed.
function lessonComplete() {
  return !!(
    findElement(
      'h2',
      e =>
        e.innerText.startsWith('Lesson Complete!') ||
        e.innerText.startsWith('Combo bonus!'),
    ) || findElement('a', e => e.innerText == 'Find events near you')
  );
}

let nextButton = null;

// It looks like Duolingo uses history.pushState to navigate between pages, so
// we can't just run the script on /skill/ URLs. I don't think that there's any
// way to detect pushState navigations from within a content script. Rather than
// adding an additional background script that uses chrome.webNavigation API and
// communicates with the content script, we just observe all DOM changes across
// the main site.
new MutationObserver(mutations => {
  if (window.location.href.indexOf('/skill/') == -1) {
    if (nextButton) {
      console.log('Left skill page');
      nextButton = null;
    }
    return;
  }

  if (nextButton == null) {
    nextButton = findElement(
      'button',
      e => e.getAttribute('data-test') == 'player-next',
    );
    if (nextButton) console.log('Found next button');
  }

  if (!nextButton || nextButton.innerText != 'CONTINUE') return;

  if (answeredCorrectly()) {
    console.log('Continuing after correct answer');
    nextButton.click();
  } else if (motivationShown()) {
    console.log('Continuing through motivational message');
    nextButton.click();
  } else if (lessonComplete()) {
    console.log('Continuing after lesson complete');
    nextButton.click();
  }
}).observe(document, {
  attributes: true,
  characterData: true,
  subtree: true,
});
