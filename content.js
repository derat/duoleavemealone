// Copyright 2019 Daniel Erat. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Current option values. Start with defaults and then update from storage.
const options = Object.assign({}, optionDefaults);
chrome.storage.sync.get(optionKeys, items => Object.assign(options, items));

// Update |options| when new values are written to storage.
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace != 'sync') return;
  optionKeys.forEach(key => {
    if (key in changes) options[key] = changes[key].newValue;
  });
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
function getStyle(e, name) {
  return getComputedStyle(e)[name];
}

// Starts watching for specific XHRs made in the page's JS context.
function injectXHRWatcher() {
  // Content scripts run in an "isolated world" outside the page's JS context
  // (https://developer.chrome.com/extensions/content_scripts#isolated_world),
  // so a script element needs to be injected via the DOM. This technique is
  // described at https://stackoverflow.com/a/9517879.
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.textContent =
    '(' +
    // For reasons that are unclear to me, console.log() doesn't work in this
    // function, which makes debugging super-fun.
    function() {
      // Each match contains a regexp matching URLs passed to open() and the
      // name of the corresponding custom event to emit. It'd be nicer to pass
      // this into the function, but we can't access bound variables here since
      // we're running in the page's context. Receiving matches here via custom
      // events from the content script seems like overkill, at least for now.
      const matches = [{re: /\/sessions$/, name: 'sessions'}];

      const xhr = XMLHttpRequest.prototype;

      const open = xhr.open;
      xhr.open = function(method, url) {
        this.url = url;
        return open.apply(this, arguments);
      };

      const send = xhr.send;
      xhr.send = function() {
        this.addEventListener('load', () => {
          // We can't directly communicate with the content script from here, so
          // we emit custom events: https://stackoverflow.com/a/19312198
          matches
            .filter(m => this.url.match(m.re))
            .forEach(m => {
              document.dispatchEvent(
                new CustomEvent(m.name, {detail: {text: this.responseText}}),
              );
            });
        });
        return send.apply(this, arguments);
      };
    } +
    ')()';
  (document.head || document.documentElement).appendChild(script);
  script.remove();
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
    this.hideTimeout = window.setTimeout(() => {
      this.div.classList.remove('shown');
    }, timeoutMs);
  }
}

// Minimum duration between evaluating the page state due to DOM mutations.
const mutationIntervalMs = 10;

// Time to wait for speech to finish before advancing stories.
// This is empirically chosen but seems to mostly work for Spanish (sometimes it
// feels a bit too long, other times too short).
const storySpeechDelayMs = 750;

// CSS color properties for various UI elements. This will break horribly
// if/when the style changes, but the CSS classes have likely-unstable names
// like '_3H0e2'. The alternative of comparing innerText to various hardcoded
// messages like 'You are correct' won't work for non-English languages.
const greenButtonColor = 'rgb(88, 167, 0)';
const correctDivColor = 'rgb(184, 242, 139)';
const correctMessageColor = 'rgb(88, 167, 0)';
const finishedMessageColor = 'rgb(60, 60, 60)';
const reviewButtonTextColor = 'rgb(175, 175, 175)';
const untimedPracticeButtonColor = 'rgb(24, 153, 214)';

// Clicks the "Continue" button to skip pointless screens.
class ButtonClicker {
  constructor() {
    this.nextButton = null;
    this.msgBox = new MessageBox();
    this.lastMutationMs = new Date().getTime();
    this.mutationTimeout = 0;
    this.storyClickTimeout = 0;
    this.numCorrectClicks = 0; // number of clicks so far in skill
    this.promptSentenceIds = {}; // prompt to sentenceId from session

    // It looks like Duolingo uses history.pushState to navigate between pages,
    // so we can't just run the script on /skill/ URLs. I don't think that
    // there's any way to detect pushState navigations from within a content
    // script. Rather than adding an additional background script that uses
    // chrome.webNavigation API and communicates with the content script, we
    // just observe DOM changes across the whole site.
    this.mutationObserver = new MutationObserver(
      this.onMutation.bind(this),
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
    document.addEventListener('sessions', e => {
      const sessions = JSON.parse(e.detail.text);
      console.log(`Got ${sessions.challenges.length} challenge(s)`);

      // There's also a sentenceDiscussionId property for each sentence, but as
      // far as I can tell it's always the same as sentenceId.
      this.promptSentenceIds = {};
      sessions.challenges.forEach(ch => {
        this.promptSentenceIds[ch.prompt] = ch.sentenceId;
      });
    });
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
        mutationIntervalMs - elapsedMs,
      );
      return;
    }

    this.lastMutationMs = now;

    const isPractice = window.location.href.indexOf('/practice') != -1;
    const isSkill = window.location.href.indexOf('/skill/') != -1;
    const isSkillTest = isSkill && window.location.href.endsWith('/test');
    const isBigTest = window.location.href.indexOf('/bigtest/') != -1;
    const isCheckpoint = window.location.href.indexOf('/checkpoint/') != -1;
    const isStory = window.location.href.indexOf('/stories/') != -1;

    if (!isPractice && !isSkill && !isBigTest && !isCheckpoint && !isStory) {
      if (this.nextButton) {
        console.log('Left page');
        this.nextButton = null;
        this.numCorrectClicks = 0;
        this.promptSentenceIds = {};
      }
      if (this.storyClickTimeout) this.cancelStoryClickTimeout();
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
        e => e.getAttribute('data-test') == 'player-next',
      );
      if (els.length == 0) return;
      console.log('Found next button');
      this.nextButton = els[0];
    }

    const buttonColor = getStyle(this.nextButton, 'background-color');

    // Skip correct answer screens.
    if (this.answeredCorrectly(buttonColor)) {
      console.log('Continuing after correct answer');

      // TODO: This message is quickly replaced by the lesson-complete message
      // after the last question, which makes it hard to click the "discuss"
      // link. Try to come up with some way to improve this.
      const content = this.cloneCorrectMessage();
      this.msgBox.show(content, 'correct', options[correctTimeoutMsKey]);

      this.numCorrectClicks++;
      this.nextButton.click();
      return;
    }

    // Auto-start practice.
    if (
      isPractice &&
      this.numCorrectClicks == 0 &&
      buttonColor == greenButtonColor
    ) {
      const els = findElements(
        'button',
        e =>
          e.getAttribute('data-test') == 'secondary-button' &&
          getStyle(e, 'background-color') == untimedPracticeButtonColor,
      );
      if (els.length == 1) {
        console.log('At practice start screen');
        const untimedPracticeButton = els[0];

        switch (options[practiceAutoStartKey]) {
          case practiceAutoStartTimed:
            console.log('Starting timed practice');
            this.nextButton.click();
            return;
          case practiceAutoStartUntimed:
            console.log('Starting untimed practice');
            untimedPracticeButton.click();
            return;
        }
      }
    }

    // Auto-start "big tests", checkpoints, and tests used to skip ahead to the
    // next level in a skill (i.e. the "key" icon).
    if (
      (isBigTest || isCheckpoint || isSkillTest) &&
      this.numCorrectClicks == 0 &&
      buttonColor == greenButtonColor &&
      // There are divs on the start screen with their data-test attributes set
      // to 'skill-icon' and 'level-crown', but they unfortunately appear to
      // remain in the DOM after the lesson is started.
      findElements('div', e => {
        const attr = e.getAttribute('data-test');
        return attr && attr.split(' ').indexOf('challenge') != -1;
      }).length == 0
    ) {
      console.log('Skipping test/checkpoint start screen');
      this.nextButton.click();
      return;
    }

    // Skip lesson completion screen.
    if (this.finishedLesson(buttonColor)) {
      const hs = findElements(
        'h2',
        e => getStyle(e, 'color') == finishedMessageColor,
      );
      console.log('Continuing after lesson: ' + hs.map(e => e.innerText));
      this.msgBox.show(
        hs.map(e => e.cloneNode(true)),
        'complete',
        options[completeTimeoutMsKey],
      );
      this.nextButton.click();
      return;
    }

    // Skip motivational messages.
    if (this.motivationShown(buttonColor)) {
      console.log('Continuing through motivational message');
      this.nextButton.click();
      return;
    }
  }

  // Handles |mutationTimeout| firing.
  onMutationTimeout() {
    this.mutationTimeout = 0;
    this.onMutation([]);
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

  // Handles a mutation during a story.
  onStoryMutation() {
    if (!options[storiesEnabledKey]) return;

    const buttons = findElements('button');
    if (!buttons.length) return;

    // At the end of the story, there are two buttons. (The first one seems to
    // correspond to the icon; no idea why.)
    if (buttons.length == 2 && !buttons[1].hasAttribute('disabled')) {
      console.log('Ending story');
      buttons[1].click();
      return;
    }

    // Otherwise, the next button has the 'autofocus' attribute.
    const nextButton = buttons.find(
      b => b.hasAttribute('autofocus') && !b.hasAttribute('disabled'),
    );
    if (!nextButton) return;

    // After a correct answer, advance immediately.
    if (findElements('h2').length) {
      console.log('Advancing story after correct answer');
      this.cancelStoryClickTimeout();
      // TODO: Maybe show the correct message here? It doesn't seem to typically
      // have interesting information, though, and its contents appear to
      // overflow the message box.
      nextButton.click();
      return;
    }

    // Otherwise, wait a bit for audio to finish and then advance the story.
    if (this.storyClickTimeout) return;
    console.log(`Will advance story in ${storySpeechDelayMs} ms`);
    this.storyClickTimeout = window.setTimeout(() => {
      this.storyClickTimeout = 0;
      console.log('Advancing story');
      nextButton.click();
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
      e => getStyle(e, 'color') == correctMessageColor,
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
    const links = clonedContainer.getElementsByTagName('a');
    const sentenceId = this.getSentenceId();
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (i == 1 && sentenceId) {
        link.addEventListener('click', () => {
          link.classList.add('loading');
          this.openComments(sentenceId).finally(() => {
            link.classList.remove('loading');
          });
        });
      } else {
        link.classList.add('hidden'); // Hide unsupported links for now.
      }
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
    const challenges = findElements('div', e => {
      const attr = e.getAttribute('data-test');
      return attr && attr.split(' ').indexOf('challenge') != -1;
    });
    if (challenges.length != 1) {
      console.log('Failed to find challenge div');
      return undefined;
    }

    const text = challenges[0].innerText;
    for (let [pr, sentenceId] of Object.entries(this.promptSentenceIds)) {
      if (text.indexOf(pr) != -1) return sentenceId;
    }

    // TODO: I've seen this happen occasionally.
    console.log(
      'Sentence ID not found for challenge:',
      text,
      this.promptSentenceIds,
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
      .then(res => res.json())
      .then(obj => {
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

// This needs to run happen any other scripts are executed so we can catch the
// /sessions file beng loaded. The script's 'run_at' property is set to
// 'document_start' in manifest.json to make this happen:
// https://developer.chrome.com/extensions/content_scripts#run_time
injectXHRWatcher();

// ButtonClicker constructs a MessageBox, which expects the DOM to be loaded:
// https://stackoverflow.com/a/28188390
document.addEventListener('DOMContentLoaded', () => {
  var clicker = new ButtonClicker();
});
