# Plan: Fix Treatments Card Hover Action Buttons

**Ticket:** N/A
**Type:** bugfix
**Status:** draft
**Author:** jussmor
**Date:** 2026-03-26
**Target Repo:** EverBetter-Pro

---

## Problem

The treatments card hover action buttons (Edit, Timeline, More) always consume horizontal space in the row layout even when invisible (`opacity-0`), because they sit **alongside** the status badges as a separate flex child. This causes the name column to get less space and creates a visible gap. The priority list grid card doesn't have this problem because the action buttons are the only right-side content.

## Approach

Merge the status badges and hover action buttons into a single overlapping container. On hover, fade out status badges and fade in action buttons — they occupy the same space instead of being side-by-side.

## Steps

### Phase 1: Restructure the right-side content (single file change)

1. In the treatments card row (`group flex items-center` div), wrap the **status badges div** and **hover action buttons div** in a single `relative flex items-center` container
2. Keep the status badges as the layout-defining element (determines the container width)
3. Add `group-hover:opacity-0 group-hover:pointer-events-none transition-opacity` to the status badges div (so it fades out on hover)
4. Change the hover action buttons div to use `absolute right-0` positioning so it overlays the status badges instead of sitting beside them
5. Remove the outer conditional `{(onEditClick || onTimelineClick) && (...)}` wrapper — always render the container, but keep the individual button conditionals inside
6. Keep existing hover opacity toggle classes on the buttons container

## Relevant Files

- `src/app/(internal)/patients/components/treatments-card/index.tsx` — lines ~840-970, the status badges div and hover action buttons div inside `displayOrders.map()`
- `src/app/(internal)/patients/components/priority-list-grid-card/index.tsx` — reference implementation (lines ~130-180)

## Verification

1. Visual: hover over a treatment row → status dot fades out, action buttons fade in, no layout shift
2. Visual: no extra horizontal space consumed when not hovering
3. Click: action buttons (edit, timeline, more) still function correctly
4. Click: clicking the row itself still opens the order view
5. Compare side-by-side with priority list card — hover behavior should feel identical

## Implementation References

| Commit SHA | Repo | Branch | Description |
| ---------- | ---- | ------ | ----------- |
|            |      |        |             |

**PR:**
