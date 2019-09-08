// Copyright 2019 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Finds an element of type |tagName| with the supplied 'data-test' attribute.
function findElement(tagName, dataTest) {
  for (const e of document.getElementsByTagName(tagName)) {
    if (e.getAttribute('data-test') == dataTest) return e;
  }
  return null;
}

// Returns true if it looks like the user has just answered a question
// correctly.
function answeredCorrectly() {
  for (const e of document.getElementsByTagName('h2')) {
    if (
      e.innerText == 'You are correct' ||
      e.innerText.startsWith('Another correct solution:') ||
      e.innerText.startsWith('Pay attention to the accents.')
    ) {
      return true;
    }
  }
  return false;
}

// Returns true if it looks like a lesson-complete screen is being displayed.
function lessonComplete() {
  for (const e of document.getElementsByTagName('h2')) {
    if (
      e.innerText.startsWith('Lesson Complete!') ||
      e.innerText.startsWith('Combo bonus!')
    ) {
      return true;
    }
  }
  for (const e of document.getElementsByTagName('a')) {
    if (e.innerText == 'Find events near you') {
      return true;
    }
  }
  return false;
}

let nextButton = null;

const observer = new MutationObserver(mutations => {
  if (!nextButton) return;

  if (answeredCorrectly()) {
    console.log('Continuing after correct answer');
    nextButton.click();
  } else if (lessonComplete()) {
    console.log('Continuing after lesson complete');
    nextButton.click();
  }
});

// Observe the <button> element that's used to advance to the next screen. The
// same button is used for correct and incorrect answers, motivational messages,
// etc. The button isn't there initially, so poll for it until it appears.
const nextButtonTimer = setInterval(() => {
  nextButton = findElement('button', 'player-next');
  if (!nextButton) return;

  console.log('Watching next button');
  clearTimeout(nextButtonTimer);
  observer.observe(nextButton, {
    subtree: true,
    // The text of the button changes to 'Continue' when it becomes clickable.
    characterData: true,
  });
}, 100);

// Observe the <div> element that's displayed when the lesson is complete.
const endCarouselTimer = setInterval(() => {
  const carousel = findElement('div', 'player-end-carousel');
  if (!carousel) return;

  console.log('Watching end carousel');
  clearTimeout(endCarouselTimer);
  observer.observe(carousel, {
    // There are a bunch of nested elements inside of this div that are used for
    // the different screens. The all appear to be present initially, so we
    // watch for attribute changes to get signaled when they're moved onscreen.
    attributes: true,
    subtree: true,
  });
}, 100);
