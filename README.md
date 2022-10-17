# duoleavemealone

**duoleavemealone** is a Chrome [content script extension] that modifies the
[Duolingo] language-learning website. It can be installed via the [Chrome Web
Store].

[Duolingo]: https://www.duolingo.com/
[content script extension]: https://developer.chrome.com/extensions/content_scripts
[Chrome Web Store]: https://chrome.google.com/webstore/detail/duoleavemealone/clipadhhddnpnocanhnbonnhppdibnpf

This extension automatically clicks the "Continue" button to skip through
certain screens:

*   Correct answer
*   Completed lesson
*   Motivational messages
*   Pre-practice/checkpoint/test screens
*   Dialogue lines in stories

The messages that would be displayed after correct answers or completed lessons
are briefly displayed onscreen instead.

Note that motivational message skipping can be unreliable. Luckily, Duolingo
provides a setting to disable these now. Unluckily, Duolingo settings are buggy
and motivational messages and animations will be automatically turned on
periodically after you turn them off:

*   <https://www.reddit.com/r/duolingo/comments/nnranh/the_motivational_messages_keep_turning_themselves/>
*   <https://www.reddit.com/r/duolingo/comments/tj65mm/motivational_messages_and_animations_user/>
*   <https://www.reddit.com/r/duolingo/comments/xp9sd6/motivational_messages_and_animations_settings/>

**This extension is not affiliated with Duolingo in any way.**
