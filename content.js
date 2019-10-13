// Copyright 2019 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Finds all elements of type |tagName| for which |f| returns true.
// If |f| is undefined, all elements will be returned.
function findElements(tagName, f) {
  // Only search under the root div created by Duolingo.
  const root = document.getElementById('root');
  if (!root) {
    console.log('Failed to find root element');
    return null;
  }
  const es = [];
  for (const e of root.getElementsByTagName(tagName)) {
    if (f === undefined || f(e)) es.push(e);
  }
  return es;
}

// Returns the value of the CSS style named |name| from element |e|.
function getStyle(e, name) {
  return getComputedStyle(e)[name];
}

// Used to briefly display a message onscreen.
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

// CSS color properties for various UI elements. This will break horribly
// if/when the style changes, but the CSS classes have likely-unstable names
// like '_3H0e2'. The alternative of comparing innerText to various hardcoded
// messages like 'You are correct' won't work for non-English languages.
const greenButtonColor = 'rgb(88, 167, 0)';
const correctDivColor = 'rgb(184, 242, 139)';
const correctMessageColor = 'rgb(88, 167, 0)';
const finishedMessageColor = 'rgb(60, 60, 60)';
const reviewButtonTextColor = 'rgb(175, 175, 175)';

// Clicks the "Continue" button to skip pointless screens.
class ButtonClicker {
  constructor() {
    this.nextButton = null;
    this.msgBox = new MessageBox();

    // It looks like Duolingo uses history.pushState to navigate between pages,
    // so we can't just run the script on /skill/ URLs. I don't think that
    // there's any way to detect pushState navigations from within a content
    // script. Rather than adding an additional background script that uses
    // chrome.webNavigation API and communicates with the content script, we
    // just observe DOM changes across the whole site.
    this.mutationObserver = new MutationObserver(
      this.onMutation.bind(this),
    ).observe(document, {
      childList: true,
      subtree: true,
    });
  }

  // Evaluates the page state whenever the DOM is mutated.
  onMutation(mutations) {
    if (window.location.href.indexOf('/skill/') == -1) {
      if (this.nextButton) {
        console.log('Left skill page');
        this.nextButton = null;
      }
      return;
    }

    if (this.nextButton == null) {
      const els = findElements(
        'button',
        e => e.getAttribute('data-test') == 'player-next',
      );
      if (els.length == 0) return;
      console.log('Found next button');
      this.nextButton = els[0];
    }

    const buttonColor = getStyle(this.nextButton, 'background-color');

    if (this.answeredCorrectly(buttonColor)) {
      const hs = findElements(
        'h2',
        e => getStyle(e, 'color') == correctMessageColor,
      );
      console.log(
        'Continuing after correct answer: ' + hs.map(e => e.innerText),
      );
      // In spoken exercises, there is sometimes a single "You are correct" h2
      // with a sibling div containing the translated text. Probably this was an
      // oversight on Duolingo's part, and they meant to nest the div within the
      // h2 as happens elsewhere.
      if (hs.length == 1) {
        for (const e of Array.from(hs[0].parentNode.childNodes)) {
          if (e.nodeName == 'DIV') hs.push(e);
        }
      }
      this.msgBox.show(hs.map(e => e.cloneNode(true)), 'correct', 2000);
      this.nextButton.click();
      return;
    }

    if (this.finishedLesson(buttonColor)) {
      const hs = findElements(
        'h2',
        e => getStyle(e, 'color') == finishedMessageColor,
      );
      console.log('Continuing after lesson: ' + hs.map(e => e.innerText));
      this.msgBox.show(hs.map(e => e.cloneNode(true)), 'complete', 3000);
      this.nextButton.click();
      return;
    }

    if (this.motivationShown(buttonColor)) {
      console.log('Continuing through motivational message');
      this.nextButton.click();
      return;
    }
  }

  // Returns true if the UI currently indicates that the user just answered a
  // question correctly.
  answeredCorrectly(buttonColor) {
    // Look for a green next button, along with a div with a light green
    // background that holds both the message and the button.
    return (
      buttonColor == greenButtonColor &&
      findElements(
        'div',
        e => getStyle(e, 'background-color') == correctDivColor,
      ).length
    );
  }

  // Returns true if the UI currently indicates that the user just completed a
  // lesson.
  finishedLesson(buttonColor) {
    // Look for a green next button, the headers that contain the completion
    // message, and the gray "review" button.
    return (
      buttonColor == greenButtonColor &&
      findElements('h2').length &&
      findElements('button', e => getStyle(e, 'color') == reviewButtonTextColor)
        .length
    );
  }

  // Returns true if a motivational message is being shown.
  motivationShown(buttonColor) {
    return (
      buttonColor == greenButtonColor &&
      findElements('div', e => {
        const img = getStyle(e, 'background-image');
        return img && img.indexOf('/owls/') != -1;
      }).length
    );
  }
}

const clicker = new ButtonClicker();
