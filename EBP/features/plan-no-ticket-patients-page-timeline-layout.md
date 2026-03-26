# Plan: Patients Page Timeline Layout

**Ticket:** N/A
**Type:** feature
**Status:** completed
**Author:** jussmor
**Date:** 2026-03-26
**Target Repo:** EverBetter-Pro

---

## Problem

The patients list page currently uses the `default` layout variant, which adds content padding, a max-width constraint, and a `bg-background` section wrapper. The page should use the `timeline` variant instead for a full-height, edge-to-edge layout that better utilizes screen space.

## Approach

Change the `variant` prop on `DefaultLayout` from `"default"` to `"timeline"` in the patients page component. This is a single-line change.

## Steps

### Phase 1: Change layout variant

1. In `src/app/(internal)/patients/page.tsx`, change `<DefaultLayout variant="default">` to `<DefaultLayout variant="timeline">`

## Relevant Files

- `src/app/(internal)/patients/page.tsx` — layout variant prop (line 17)
- `src/components/layout/default-layout.tsx` — layout variant definitions (reference only, no changes)

## Verification

1. Navigate to `/patients` — page should use timeline layout (full height, no max-width constraint, no extra section padding)
2. Data table should fill available vertical space
3. Sidebar and header should remain unchanged
4. No visual regressions on other pages (change is scoped to patients page only)

## Implementation References

| Commit SHA | Repo | Branch | Description |
| ---------- | ---- | ------ | ----------- |
|            |      |        |             |

**PR:**