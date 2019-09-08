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

// This class interacts with the skill page.
class SkillHandler {
  constructor() {
    this.observer = new MutationObserver(mutations => {
      if (!this.nextButton) return;

      if (this.answeredCorrectly()) {
        console.log('Continuing after correct answer');
        this.nextButton.click();
      } else if (this.lessonComplete()) {
        console.log('Continuing after lesson complete');
        this.nextButton.click();
      }
    });

    // Observe the <button> element that's used to advance to the next screen. The
    // same button is used for correct and incorrect answers, motivational messages,
    // etc. The button isn't there initially, so poll for it until it appears.
    this.nextButtonTimer = setInterval(() => {
      this.nextButton = findElement(
        'button',
        e => e.getAttribute('data-test') == 'player-next',
      );
      if (!this.nextButton) return;

      clearTimeout(this.nextButtonTimer);
      this.nextButtonTimer = null;

      console.log('Watching next button');
      this.observer.observe(this.nextButton, {
        subtree: true,
        // The text of the button changes to 'Continue' when it becomes clickable.
        characterData: true,
      });
    }, 100);

    // Observe the <div> element that's displayed when the lesson is complete.
    this.endCarouselTimer = setInterval(() => {
      const carousel = findElement(
        'div',
        e => e.getAttribute('data-test') == 'player-end-carousel',
      );
      if (!carousel) return;

      clearTimeout(this.endCarouselTimer);
      this.endCarouselTimer = null;

      console.log('Watching end carousel');
      this.observer.observe(carousel, {
        // There are a bunch of nested elements inside of this div that are used for
        // the different screens. The all appear to be present initially, so we
        // watch for attribute changes to get signaled when they're moved onscreen.
        attributes: true,
        subtree: true,
      });
    }, 100);
  }

  // Cleans up resources.
  stop() {
    this.observer.disconnect();
    if (this.nextButtonTimer) clearTimeout(this.nextButtonTimer);
    if (this.endCarouselTimer) clearTimeout(this.endCarouselTimer);
  }

  // Returns true if it looks like the user has just answered a question
  // correctly.
  answeredCorrectly() {
    return findElement(
      'h2',
      e =>
        e.innerText == 'You are correct' ||
        e.innerText.startsWith('Another correct solution:') ||
        e.innerText.startsWith('Pay attention to the accents.'),
    );
  }

  // Returns true if it looks like a lesson-complete screen is being displayed.
  lessonComplete() {
    return (
      findElement(
        'h2',
        e =>
          e.innerText.startsWith('Lesson Complete!') ||
          e.innerText.startsWith('Combo bonus!'),
      ) || findElement('a', e => e.innerText == 'Find events near you')
    );
  }
}

let skillHandler = null;

// This is disgusting and wasteful. Navigation between pages looks like it
// happens using history.pushState, which means that our content script won't be
// loaded if we just mach /skill URLs. So, we instead run in the whole domain
// and poll the URL to determine when we're on a skill page. I think that the
// "right" way to handle this is to also have a background page that uses
// something like chrome.webNavigation to watch for changes. Note that the
// skill-related code is already terrible and polls in order to watch for the
// next buttond and end carousel. :-/
const locationTimer = setInterval(() => {
  const inSkill = window.location.href.indexOf('/skill/') != -1;
  if (inSkill && !skillHandler) {
    console.log('Entered skill page');
    skillHandler = new SkillHandler();
  } else if (!inSkill && skillHandler) {
    console.log('Left skill page');
    skillHandler.stop();
    skillHandler = null;
  }
}, 1000);
