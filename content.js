// Copyright 2019 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Finds the first element of type |tagName| for which |f| returns true.
function findElement(tagName, f) {
  // Only search under the root div created by Duolingo.
  const root = document.getElementById('root');
  if (!root) {
    console.log('Failed to find root element');
    return null;
  }
  for (const e of root.getElementsByTagName(tagName)) {
    if (f(e)) return e;
  }
  return null;
}

// Returns the h2 element containing the success message if it looks like the
// user has just answered a question correctly.
function getCorrectAnswerElement() {
  return findElement(
    'h2',
    e =>
      e.innerText == 'You are correct' ||
      e.innerText.startsWith('Another correct solution:') ||
      e.innerText.startsWith('Pay attention to the accents.') ||
      e.innerText.startsWith('You have a typo.'),
  );
}

// Returns an array of currently-displayed lesson-complete h2 elements.
// Returns an empty array if no elements are found.
function getLessonCompleteElements() {
  return ['Lesson Complete!', 'Combo bonus!']
    .map(p => findElement('h2', e => e.innerText.startsWith(p)))
    .filter(e => e);
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

// Used to display a message onscreen for a brief period.
class MessageBox {
  constructor() {
    this.div = document.createElement('div');
    this.div.id = 'duoleavemealone-msg';
    document.body.appendChild(this.div);
  }

  // Shows |contents|, which may be a single element or an array of elements.
  // |role| describes the message's role, i.e. 'correct' or 'complete'.
  show(content, role, timeoutMs) {
    while (this.div.firstChild) this.div.removeChild(this.div.firstChild);
    if (Array.isArray(content)) {
      content.forEach(e => this.div.appendChild(e));
    } else {
      this.div.appendChild(content);
    }

    if (this.role) this.div.classList.remove(this.role);
    this.div.classList.add('shown', role);
    this.role = role;

    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => {
      this.div.classList.remove('shown');
    }, timeoutMs);
  }
}

let msgBox = new MessageBox();

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

  const element = getCorrectAnswerElement();
  if (element) {
    console.log(`Continuing after correct answer: "${element.innerText}"`);
    msgBox.show(element.cloneNode(true), 'correct', 2000);
    nextButton.click();
    return;
  }

  const elements = getLessonCompleteElements();
  if (elements.length) {
    console.log(
      `Continuing after lesson complete: ${elements.map(e => e.innerText)}`,
    );
    msgBox.show(elements.map(e => e.cloneNode(true)), 'complete', 3000);
    nextButton.click();
    return;
  }

  if (motivationShown()) {
    console.log('Continuing through motivational message');
    nextButton.click();
    return;
  }
}).observe(document, {
  attributes: true,
  characterData: true,
  subtree: true,
});
