# Watched Plans UX Notes

## Recommendation

Do not place watched plans inside the primary transactions toggle.

Instead:
- show a conditional `Watching` module on Summary when watched plans exist
- tap through to a dedicated watched-plans screen
- keep the feature absent from top-level nav when there are zero watched plans

## Why this is better

- keeps recorded spending separate from planned spending
- avoids a dead or confusing tab when no watched plans exist
- creates a clean mental model:
  - Summary = what is happening now
  - Watching = what you are actively keeping an eye on

## Summary entry point

Placement:
- below `Quick entry`
- above insights

Content:
- title: `Watching`
- count: `2 active plans`
- one-line summary:
  - `1 got easier · 1 got tighter`
- CTA:
  - `See plans`

This should feel like a compact utility module, not a marketing card.

## Dedicated watched-plans screen

Purpose:
- a focused place to review active watched purchases
- not a transaction log

Row content:
- label
- amount
- scope
- current status
- change cue:
  - `Looks easier now`
  - `Tighter than before`
- short reason:
  - `$60 more room opened up`
  - `$45 less room is left now`

Row actions:
- tap to rerun
- lightweight secondary action:
  - `Stop watching`

## Empty-state behavior

If zero watched plans:
- do not show the Summary module
- watched-plans screen can still exist if linked from scenario planning, but should show:
  - `No watched plans yet`
  - `Watch a plan from a scenario result to keep an eye on it here.`

## Product principle

Watched plans should feel:
- intentional
- useful
- separate from your recorded expense ledger

Not:
- like another transaction filter
- like a sticky archive of every plan you ever checked
