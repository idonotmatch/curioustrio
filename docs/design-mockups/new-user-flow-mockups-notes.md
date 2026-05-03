# New User Flow Mockups

These mockups explore a more cohesive first-run experience for Adlo.

They are based on the current app architecture in:

- [/Users/dangnguyen/curious-trio/mobile/app/login.js](/Users/dangnguyen/curious-trio/mobile/app/login.js)
- [/Users/dangnguyen/curious-trio/mobile/app/onboarding.js](/Users/dangnguyen/curious-trio/mobile/app/onboarding.js)
- [/Users/dangnguyen/curious-trio/mobile/app/(tabs)/summary.js](/Users/dangnguyen/curious-trio/mobile/app/(tabs)/summary.js)
- [/Users/dangnguyen/curious-trio/mobile/app/(tabs)/index.js](/Users/dangnguyen/curious-trio/mobile/app/(tabs)/index.js)
- [/Users/dangnguyen/curious-trio/mobile/app/gmail-import.js](/Users/dangnguyen/curious-trio/mobile/app/gmail-import.js)

## Shared principles

- Setup should feel like momentum, not admin
- Solo use should be intentional, not a skip
- The first-run path should guide toward:
  - first expense
  - budget
  - Gmail
- Summary should help a new user progress, not diagnose emptiness

## Mockups

- `new-user-auth-choice.svg`
  - redesign of the existing login screen
  - clearer framing for guest mode
  - calmer "what happens next" positioning

- `new-user-setup-path.svg`
  - replacement for the current household-only onboarding
  - asks how the user is starting:
    - solo
    - create household
    - join household

- `new-user-setup-checklist.svg`
  - new intermediate setup screen
  - turns setup into a progress checklist
  - keeps one clear next action visible

- `new-user-summary-first-run.svg`
  - Summary redesign for thin-history accounts
  - setup card replaces the current diagnostics-heavy empty state

## Recommendation

If we only add one new screen, it should be:

- `getting-started`

That is the missing bridge between:

- "I authenticated"
- and
- "I understand how to make Adlo useful"

Without that screen, we keep asking Summary and Settings to do onboarding work they were not built to do.
