// Copyright 2019 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as constants from './constants.js';

// Current option values. Start with defaults and then update from storage.
const options = Object.assign({}, constants.optionDefaults);
chrome.storage.sync.get(constants.optionKeys, (items) =>
  Object.assign(options, items)
);

// Update |options| when new values are written to storage.
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace != 'sync') return;
  constants.optionKeys.forEach((key) => {
    if (key in changes) options[key] = changes[key].newValue;
  });
});

// Has the extension been temporarily disabled via the browser action icon?
let extensionDisabled = false;

// Listen for messages from background.js.
chrome.runtime.onMessage.addListener((req, sender, cb) => {
  if (req.type === constants.toggleMsg) {
    extensionDisabled = !extensionDisabled;
    if (extensionDisabled) {
      console.log('Disabling duoleavemealone');
      chrome.runtime.sendMessage({ type: constants.disabledMsg });
    } else {
      console.log('Enabling duoleavemealone');
      chrome.runtime.sendMessage({ type: constants.enabledMsg });
    }
  }
});

// Finds all elements of type |tagName| under |root| for which |f| returns true.
// If |f| is undefined or null, all elements will be returned.
// If |root| is undefined, Duolingo's root div will be searched.
function findElements(tagName, f, root) {
  if (!root) root = document.getElementById('root');
  if (!root) {
    console.log('Failed to find root element');
    return [];
  }
  const es = [];
  for (const e of root.getElementsByTagName(tagName)) {
    if (!f || f(e)) es.push(e);
  }
  return es;
}

// Returns the value of the CSS style named |name| from element |e|.
function getStyle(e, name, pseudo) {
  return getComputedStyle(e, pseudo)[name];
}

// Like getStyle(), but tries to convert the color value to #rrggbb.
// Chrome's getComputedStyle() seems to always return colors as rgb().
// Based on https://stackoverflow.com/a/3627747/6882947.
function getColorStyle(e, name, pseudo) {
  const color = getStyle(e, name, pseudo);
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;

  // This also matches rgb() tuples at the beginning of longer styles,
  // e.g. box-shadow.
  const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!rgb) return color;

  const hex = (n) => ('0' + parseInt(n).toString(16)).slice(-2);
  return '#' + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
}

// Returns an #rrggbb color for the supplied button element, handling various
// ways that Duolingo sets button colors.
function getButtonColor(button) {
  const transparent = 'rgba(0, 0, 0, 0)';

  // This was the old, cromulent way of doing things:
  // set the button's 'background-color' style to an opaque color.
  if (getStyle(button, 'background-color') !== transparent) {
    return getColorStyle(button, 'background-color');
  }

  // Starting around 20210719, the end-of-skill continue button became
  // transparent, with the color assigned via a ::before pseudoelement.
  if (getStyle(button, 'background-color', '::before') !== transparent) {
    return getColorStyle(button, 'background-color', '::before');
  }

  // The continue button for "Legendary" start screens is styled with a linear
  // gradient, but it looks like we can get an approximation of its color by
  // looking at the shadow on its ::before pseudoelement.
  if (getStyle(button, 'box-shadow', '::before').startsWith('rgb(')) {
    return getColorStyle(button, 'box-shadow', '::before');
  }

  // The mid-skill buttons are also transparent, but colors are
  // slightly-more-sensibly assigned via the parent div's 'color' style.
  return getStyle(button.parentElement, 'color');
}

// Used to briefly display a message onscreen.
class MessageBox {
  constructor() {
    this.div = document.createElement('div');
    this.div.id = 'duoleavemealone-msg';
    this.classes = [];
    document.body.appendChild(this.div);
  }

  // Shows |contents|, which may be a single element or an array of elements.
  // |classes| contains CSS classes, i.e. 'correct' or 'complete'.
  show(content, classes, timeoutMs) {
    while (this.div.firstChild) this.div.removeChild(this.div.firstChild);
    if (Array.isArray(content)) {
      content.forEach((e) => this.div.appendChild(e));
    } else {
      this.div.appendChild(content);
    }

    this.classes.forEach((cl) => this.div.classList.remove(cl));
    this.div.classList.add('shown', ...classes);
    this.classes = classes;

    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = window.setTimeout(() => {
      this.div.classList.remove('shown');
    }, timeoutMs);
  }
}

// Minimum duration between evaluating the page state due to DOM mutations.
const mutationIntervalMs = 10;

// Maximum number of clicks to perform in a second and duration to back off if
// we exceed it.
const maxClicksPerSec = 5;
const backoffSec = 5;

// Time to wait for speech to finish before advancing stories.
// This is empirically chosen but seems to mostly work for Spanish (sometimes it
// feels a bit too long, other times too short).
const storySpeechDelayMs = 750;

// CSS color properties for various UI elements. This will break horribly
// if/when the style changes, but the CSS classes have likely-unstable names
// like '_3H0e2'. The alternative of comparing innerText to various hardcoded
// messages like 'You are correct' won't work for non-English languages.
const greenButtonColors = ['#58a700', '#58cc02'];
const correctDivColor = '#d7ffb8';
const correctMessageColor = '#58a700';
const finishedMessageColor = '#3c3c3c';
const reviewButtonTextColor = '#afafaf';
const untimedPracticeButtonColor = '#1899d6';
const storyCompleteButtonColors = ['#1899d6', '#1cb0f6'];
const legendaryStartButtonColor = '#4755df';

// Clicks the "Continue" button to skip pointless screens.
class ButtonClicker {
  constructor() {
    this.nextButton = null;
    this.msgBox = new MessageBox();
    this.lastMutationMs = new Date().getTime();
    this.mutationTimeout = 0;
    this.storyClickTimeout = 0;
    this.numCorrectClicks = 0; // number of clicks so far in skill
    this.promptDiscussionIds = {}; // prompt to sentenceDiscussionId from session
    this.numRecentClicks = 0; // number of clicks in |recentClicksSec|
    this.recentClicksSec = -1; // second since epoch for |numRecentClicks|

    // It looks like Duolingo uses history.pushState to navigate between pages,
    // so we can't just run the script on /skill/ URLs. I don't think that
    // there's any way to detect pushState navigations from within a content
    // script. Rather than adding an additional background script that uses
    // chrome.webNavigation API and communicates with the content script, we
    // just observe DOM changes across the whole site.
    this.mutationObserver = new MutationObserver(
      this.onMutation.bind(this)
    ).observe(document, {
      attributeFilter: ['autofocus'],
      attributes: true,
      childList: true,
      subtree: true,
    });

    // Watch for session data being received when a new skill is started.
    // We use this to get sentence IDs, which we can later use to call the
    // /sentence endpoint to get the comment ID of the sentence's discussion
    // thread.
    document.addEventListener('sessions', (e) => {
      const sessions =
        typeof e.detail.response === 'string'
          ? JSON.parse(e.detail.response)
          : e.detail.response;
      if (typeof sessions.challenges === 'undefined') {
        console.log("Session data doesn't contain challenges");
        return;
      }
      console.log(`Got ${sessions.challenges.length} challenge(s)`);
      this.promptDiscussionIds = {};
      sessions.challenges.forEach((ch) => {
        this.promptDiscussionIds[ch.prompt] = ch.sentenceDiscussionId;
      });
    });
  }

  // Clicks |button| and increments |numRecentClicks|.
  // Call this instead of clicking the button directly for rate-limiting.
  click(button) {
    button.click();

    const now = parseInt(new Date().getTime() / 1000);
    if (now != this.recentClicksSec) {
      this.recentClicksSec = now;
      this.numRecentClicks = 0;
    }
    this.numRecentClicks++;

    if (this.numRecentClicks > maxClicksPerSec) {
      console.log(
        `Exceeded ${maxClicksPerSec} clicks in last second; ` +
          `backing off for ${backoffSec} seconds`
      );
    }
  }

  // Evaluates the page state whenever the DOM is mutated.
  onMutation(mutations) {
    // Bail out if there's already a scheduled call.
    if (this.mutationTimeout) return;

    // Rate-limit calls.
    const now = new Date().getTime();
    const elapsedMs = now - this.lastMutationMs;
    if (elapsedMs < mutationIntervalMs) {
      this.mutationTimeout = window.setTimeout(
        this.onMutationTimeout.bind(this),
        mutationIntervalMs - elapsedMs
      );
      return;
    }

    this.lastMutationMs = now;

    const href = window.location.href;
    const isPractice = href.includes('/practice'); // skill that's already been gilded
    const isProgressQuiz = href.includes('/progress-quiz/'); // for Plus accounts
    const isPlacement = href.includes('/placement/'); // before creating account
    const isSkill = href.includes('/skill/'); // skill that hasn't been gilded yet or legendary
    const isSkillTest = isSkill && href.endsWith('/test'); // "key" icon to skip to next level
    const isCheckpoint = href.includes('/checkpoint/'); // "castle" icon between skills
    const isBigTest = href.includes('/bigtest/'); // checkpoint that hasn't been completed yet
    const isAlphabet = href.includes('/alphabets/'); // alphabet/character practice
    const isLesson = href.includes('/lesson/') || href.endsWith('/lesson'); // 2022 tree redesign
    const isStory = href.includes('/stories/');

    // Bail out if we're no longer at a URL where there are buttons to click.
    if (
      !isPractice &&
      !isProgressQuiz &&
      !isPlacement &&
      !isSkill && // includes |isSkillTest|
      !isCheckpoint &&
      !isBigTest &&
      !isAlphabet &&
      !isLesson &&
      !isStory
    ) {
      if (this.nextButton) {
        console.log('Left page');
        this.resetLesson();
      }
      if (this.storyClickTimeout) this.cancelStoryClickTimeout();
      return;
    }

    // Bail out if the user temporarily disabled us via the browser action icon.
    if (extensionDisabled) return;

    // Bail out if we've been clicking too much, since it indicates that
    // something is probably wrong:
    // https://github.com/derat/duoleavemealone/issues/29
    if (
      this.numRecentClicks > maxClicksPerSec &&
      parseInt(now / 1000) < this.recentClicksSec + backoffSec
    ) {
      return;
    }

    // Duolingo's story implementation appears to be completely different from
    // regular lessons, unfortunately. There don't seem to be 'data-test'
    // attributes that can be used to identify different elements' roles.
    if (isStory) {
      this.onStoryMutation();
      return;
    }

    if (!this.nextButton) {
      const els = findElements(
        'button',
        (e) => e.getAttribute('data-test') == 'player-next'
      );
      if (els.length == 0) return;
      console.log('Found next button');
      this.nextButton = els[0];
    }

    const buttonColor = getButtonColor(this.nextButton);

    // Skip correct answer screens.
    if (this.answeredCorrectly(buttonColor)) {
      if (!options[constants.skipCorrectKey]) return;

      console.log('Continuing after correct answer');
      const content = this.cloneCorrectMessage();
      const classes = ['correct'];

      // Change the color for e.g. typos or "meaning" messages, which have an
      // additional <span> alongside the <h2>.
      if (
        content.firstChild &&
        content.firstChild.firstChild &&
        content.firstChild.firstChild.childElementCount > 1
      ) {
        classes.push('has-extra');
      }

      // TODO: This message is quickly replaced by the lesson-complete message
      // after the last question, which makes it hard to click the "discuss"
      // link. Try to come up with some way to improve this.
      this.msgBox.show(
        content,
        classes,
        options[constants.correctTimeoutMsKey]
      );

      this.numCorrectClicks++;
      this.click(this.nextButton);
      return;
    }

    // Auto-start practice.
    if (
      isPractice &&
      this.numCorrectClicks == 0 &&
      greenButtonColors.includes(buttonColor)
    ) {
      const els = findElements(
        'button',
        (e) =>
          e.getAttribute('data-test') == 'secondary-button' &&
          getColorStyle(e, 'background-color') == untimedPracticeButtonColor
      );
      if (els.length == 1) {
        console.log('At practice start screen');
        const untimedPracticeButton = els[0];

        switch (options[constants.practiceAutoStartKey]) {
          case constants.practiceAutoStartTimed:
            console.log('Starting timed practice');
            this.click(this.nextButton);
            return;
          case constants.practiceAutoStartUntimed:
            console.log('Starting untimed practice');
            this.click(untimedPracticeButton);
            return;
        }
      }
    }

    // Auto-start sequences that just have a single start button.
    if (
      (isAlphabet || isBigTest || isCheckpoint || isPlacement || isSkillTest) &&
      this.numCorrectClicks == 0 &&
      greenButtonColors.includes(buttonColor) &&
      // There are divs on the start screen with their data-test attributes set
      // to 'skill-icon' and 'level-crown', but they unfortunately appear to
      // remain in the DOM after the lesson is started.
      findElements('div', (e) => {
        const attr = e.getAttribute('data-test');
        return attr && attr.split(' ').indexOf('challenge') != -1;
      }).length == 0
    ) {
      console.log('Skipping start screen');
      this.click(this.nextButton);
      return;
    }

    if (isSkill) {
      // The skill page (seen when you click on a skill that hasn't been gilded
      // yet) usually doesn't have a start screen, but it does when you get
      // there by going for the "legendary" level on a skill that you've already
      // gilded.
      if (
        this.numCorrectClicks == 0 &&
        buttonColor == legendaryStartButtonColor
      ) {
        console.log('Skipping legendary start screen');
        this.click(this.nextButton);
        return;
      }

      // There's also a special screen when finishing a legendary level.
      const legendaryFinish = findElements(
        'button',
        (e) => e.getAttribute('data-test') == 'continue-final-level'
      );
      if (legendaryFinish.length > 0) {
        console.log('Finishing legendary level');
        this.click(legendaryFinish[0]);
        return;
      }
    }

    // Skip lesson completion screen.
    if (this.finishedLesson(buttonColor)) {
      // Avoid clicking buttons if we're at the 'legendary' start/end screen,
      // since it has multiple options (start button and close button to return
      // to home screen) and additionally displays a prompt to either pay
      // lingots or upgrade to Plus when the start button is clicked:
      // https://github.com/derat/duoleavemealone/issues/29
      const overlays = document.getElementById('overlays');
      const legendary =
        overlays &&
        !!findElements(
          'a',
          (e) =>
            e.getAttribute('data-test') == 'cta-button' &&
            e.getAttribute('href').startsWith('/skill/'),
          overlays
        ).length;
      if (legendary) {
        // We don't get bounced back to the main URL between legendary lessons,
        // so we need to manually reset the state to find the new 'next' button.
        this.resetLesson();
      } else {
        const hs = findElements(
          'h2',
          (e) => getColorStyle(e, 'color') == finishedMessageColor
        );
        console.log('Continuing after lesson: ' + hs.map((e) => e.innerText));
        this.msgBox.show(
          hs.map((e) => e.cloneNode(true)),
          ['complete'],
          options[constants.completeTimeoutMsKey]
        );
        this.click(this.nextButton);
        return;
      }
    }

    // Skip motivational messages.
    if (this.motivationShown(buttonColor)) {
      console.log('Continuing through motivational message');
      this.click(this.nextButton);
      return;
    }
  }

  // Handles |mutationTimeout| firing.
  onMutationTimeout() {
    this.mutationTimeout = 0;
    this.onMutation([]);
  }

  resetLesson() {
    this.nextButton = null;
    this.numCorrectClicks = 0;
    this.promptDiscussionIds = {};
  }

  // Returns true if the UI currently indicates that the user just answered a
  // question correctly.
  answeredCorrectly(buttonColor) {
    // Look for a green next button, along with a div with a light green
    // background that holds both the message and the button.
    return (
      greenButtonColors.includes(buttonColor) &&
      findElements(
        'div',
        (e) => getColorStyle(e, 'background-color') == correctDivColor
      ).length
    );
  }

  // Returns true if the UI currently indicates that the user just completed a
  // lesson.
  finishedLesson(buttonColor) {
    // Look for a green next button, the headers that contain the completion
    // message, and the gray "review" button.
    return (
      greenButtonColors.includes(buttonColor) &&
      findElements('h2').length &&
      findElements(
        'button',
        (e) => getColorStyle(e, 'color') == reviewButtonTextColor
      ).length
    );
  }

  // Returns true if a motivational message is being shown.
  motivationShown(buttonColor) {
    return (
      greenButtonColors.includes(buttonColor) &&
      findElements('div', (e) => {
        const img = getStyle(e, 'background-image');
        return img && img.indexOf('/owls/') != -1;
      }).length
    );
  }

  // Handles a mutation during a story.
  onStoryMutation() {
    if (!options[constants.storiesEnabledKey]) return;

    const buttons = findElements('button', (b) => !b.hasAttribute('disabled'));
    if (!buttons.length) return;

    // As of late 2020, there seems to be a single blue 'Continue' button with
    // 'data-test' set to 'stories-player-done' at the end of the story.
    // Earlier, there were two buttons (with the first one oddly corresponding
    // to the icon).
    //
    // Note that there's also a 'stories-player-continue' button that gets used
    // both for advancing within the story and for skipping a few random screens
    // at the end of the story. That button is handled later in this method.
    const doneButton = buttons.find(
      (b) => b.getAttribute('data-test') === 'stories-player-done'
    );
    if (doneButton) {
      console.log('Ending story');
      // The structure of the story completion message is a bit different, e.g.:
      //
      // <div>
      //   <div>[treasure-chest icon]</div>
      //   <h2>"You've reached your daily goal"</h2>
      //   <div>
      //     <span>
      //       <span>Story complete!</span>
      //       <span>+14 XP</span>
      //     </span>
      //   </div>
      //   ...
      //
      // Sometimes there's also a second h2 in the doc containing "Story complete!".
      // Just grab the first h2 and the div after it.
      const hs = findElements('h2');
      if (hs.length) {
        const els = [hs[0]];
        const sib = hs[0].nextSibling;
        if (sib && sib.tagName == 'DIV') els.push(sib);
        this.msgBox.show(
          els.map((e) => e.cloneNode(true)),
          ['complete', 'story'],
          options[constants.completeTimeoutMsKey]
        );
      }
      this.click(doneButton);
      return;
    }

    // Otherwise, the next button has the 'autofocus' attribute.
    const nextButton = buttons.find((b) => b.hasAttribute('autofocus'));
    if (!nextButton) return;
    const buttonColor = getButtonColor(nextButton);

    // Skip the "You've earned __ XP today" screen at the end of the story.
    if (storyCompleteButtonColors.includes(buttonColor)) {
      console.log('Advancing through end-of-story screen');
      this.click(nextButton);
      return;
    }

    // After an incorrect text-entry answer, the button is red
    // ("rgb(234, 43, 43)") rather than green. Don't click it in that case.
    if (!greenButtonColors.includes(buttonColor)) return;

    // After a correct answer, advance immediately.
    if (findElements('h2').length) {
      console.log('Advancing story after correct answer');
      this.cancelStoryClickTimeout();
      // TODO: Maybe show the correct message here? It doesn't seem to typically
      // have interesting information, though, and its contents appear to
      // overflow the message box.
      this.click(nextButton);
      return;
    }

    // Most stories worth 20 XP or more include a text input challenge. The next
    // button becomes clickable as soon as a character is typed. Make sure that
    // we don't prematurely click the button while the user is answering (issue
    // #17). The textarea is still present after they submit their answer, but
    // it gets a 'disabled' attribute.
    if (
      findElements(
        'textarea',
        (e) =>
          e.getAttribute('data-test') == 'stories-text-input' &&
          !e.hasAttribute('disabled')
      ).length
    ) {
      return;
    }

    // Otherwise, wait a bit for audio to finish and then advance the story.
    if (this.storyClickTimeout) return;
    console.log(`Will advance story in ${storySpeechDelayMs} ms`);
    this.storyClickTimeout = window.setTimeout(() => {
      this.storyClickTimeout = 0;
      console.log('Advancing story');
      this.click(nextButton);
    }, storySpeechDelayMs);
  }

  // Cancels |storyClickTimeout| if it's set.
  cancelStoryClickTimeout() {
    if (this.storyClickTimeout) {
      window.clearTimeout(this.storyClickTimeout);
      this.storyClickTimeout = 0;
    }
  }

  // Clones the div containing the message displayed after a correct answer,
  // along with related content.
  cloneCorrectMessage() {
    // The structure of the "correct" message seems to be a subset of the
    // following:
    //
    // ...
    //   <div>
    //     <div>
    //       <div>
    //         <h2>You are correct</h2>
    //         <!-- maybe other h2s? -->
    //       </div>
    //       <div>
    //         <span><!-- more spans containing e.g. typo --></span>
    //       </div>
    //     </div>
    //     <div>
    //       <a>
    //         <div></div><!-- flag icon -->
    //         <span>Report</span>
    //       <a>
    //         <div></div><!-- speech bubble icon -->
    //         <span>Discuss</span>
    //
    // We clone the top <div> in the above hierarchy.
    const hs = findElements(
      'h2',
      (e) => getColorStyle(e, 'color') == correctMessageColor
    );

    if (
      hs.length < 1 ||
      hs[0].parentNode.nodeName != 'DIV' ||
      hs[0].parentNode.parentNode.nodeName != 'DIV' ||
      hs[0].parentNode.parentNode.parentNode.nodeName != 'DIV'
    ) {
      console.log('Failed to find correct message: ', hs);
      return [];
    }

    const container = hs[0].parentNode.parentNode.parentNode;
    const clonedContainer = container.cloneNode(true);

    // Event listeners don't get cloned, unfortunately. Add our own listener for
    // the discuss link so we can open a window with the corresponding comment
    // thread.
    //
    // The flag and discuss icon divs have background-image properties with URLs
    // like the following:
    //   url(//d35aaqx5ub95lt.cloudfront.net/images/grading-ribbon-flag-correct.svg)
    //   url(//d35aaqx5ub95lt.cloudfront.net/images/grading-ribbon-discuss-correct.svg)
    //
    // Unfortunately, they don't appear to be styled at the point where this
    // code runs, so just assume that the second one is the discussion link. I
    // hope that this isn't broken for RTL... :-/
    const links = clonedContainer.getElementsByTagName('button');
    const sentenceId = this.getSentenceId();
    let linkContainer = null; // <div> containing links
    let showingLink = false;
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (!linkContainer) linkContainer = link.parentNode;
      if (i == 1 && sentenceId) {
        link.addEventListener('click', () => {
          link.classList.add('loading');
          this.openComments(sentenceId).finally(() => {
            link.classList.remove('loading');
          });
        });
        showingLink = true;
      } else {
        link.classList.add('hidden'); // Hide unsupported links for now.
      }
    }
    // The link container has a margin on top, so drop it if it's empty.
    if (linkContainer && !showingLink) {
      linkContainer.parentNode.removeChild(linkContainer);
    }

    return clonedContainer;
  }

  // getSentenceId attempts to find the ID of the currently-displayed
  // prompt/sentence/challenge.
  getSentenceId() {
    // We can't take the obvious route of just using the challenge order from
    // the session object, since the user may get some of the questions wrong
    // (in which case Duolingo skips over them and then returns to them at the
    // end of the lesson). Instead, we take the hacky approach of looking for a
    // prompt from the session that shows up in the page's challenge text. This
    // seems fragile (what if prompts overlap?) but I haven't found an alternate
    // approach.
    const challenges = findElements('div', (e) => {
      const attr = e.getAttribute('data-test');
      return attr && attr.split(' ').indexOf('challenge') != -1;
    });
    if (challenges.length != 1) {
      console.log('Failed to find challenge div');
      return undefined;
    }

    const text = challenges[0].innerText;
    for (let [pr, sentenceId] of Object.entries(this.promptDiscussionIds)) {
      if (text.indexOf(pr) != -1) return sentenceId;
    }

    // TODO: I've seen this happen occasionally.
    console.log(
      'Sentence ID not found for challenge:',
      text,
      this.promptDiscussionIds
    );
    return undefined;
  }

  // Asynchronously opens a new window displaying the discussion thread for the
  // supplied sentence. Returns a promise that is resolved when the window is
  // opened.
  openComments(sentenceId) {
    // Getting the comment ID from Duolingo can take a long time, so open the
    // window first so it doesn't pop up at a random point in the future.
    const win = window.open();
    win.document.body.innerHTML = `Loading discussion...`;

    const sentenceUrl = `/sentence/${sentenceId}`;
    console.log(`Requesting ${sentenceUrl}`);
    return fetch(sentenceUrl)
      .then((res) => res.json())
      .then((obj) => {
        // TODO: I noticed the 'comment' property missing once; dunno why.
        const commentId = obj.comment.id;
        const commentUrl = `https://forum.duolingo.com/comment/${commentId}`;
        console.log(`Opening discussion thread ${commentUrl}`);
        // TODO: Consider adding an option to control whether the new tab is
        // focused or not. That's straightforward to do with chrome.tabs.create,
        // except we can't call Chrome APIs from a content script, so we'd
        // probably need to create a background page and send a message to it.
        win.location = commentUrl;
      });
  }
}

// Start watching for specific XHRs made in the page's JS context.
//
// This needs to run before any other scripts are executed so we can catch the
// /sessions file beng loaded. The script's 'run_at' property is set to
// 'document_start' in manifest.json to make this happen:
// https://developer.chrome.com/extensions/content_scripts#run_time
//
// Content scripts run in an "isolated world" outside the page's JS context
// (https://developer.chrome.com/extensions/content_scripts#isolated_world),
// so a script element needs to be injected via the DOM. This technique is
// described at https://stackoverflow.com/a/9517879.
(() => {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('xhr.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// ButtonClicker constructs a MessageBox, which expects the DOM to be loaded:
// https://stackoverflow.com/a/28188390
document.addEventListener('DOMContentLoaded', () => {
  var clicker = new ButtonClicker();
});
