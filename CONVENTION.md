# AI-Plans-FE Convention

This document defines the rules and conventions for writing, organizing, and maintaining plans in this repository.

---

## Purpose

AI-Plans-FE is the **centralized plan storage** for all MaxwellClinic frontend repositories. Each project gets a top-level folder. Plans track the _what_, _why_, and _how_ of every significant change — features, bugfixes, hotfixes, refactors, and chores.

Plans are consumed via **git submodules**. Plan file content is never committed to consuming repos — only the submodule SHA pointer travels with the parent repo.

---

## Folder Structure

Each registered project has a top-level folder with five category subdirectories:

```
<PROJECT_SHORT_NAME>/
├── features/       # New features (feat)
├── bugfixes/       # Bug fixes (fix, bugfix)
├── hotfixes/       # Urgent production fixes (hotfix)
├── refactors/      # Code restructuring (refactor)
└── chores/         # Maintenance, deps, tooling (chore)
```

### Category Definitions

| Category     | Maps To             | When to Use                                              |
| ------------ | ------------------- | -------------------------------------------------------- |
| `features/`  | `feat:` commits     | New functionality, UI additions, new endpoints           |
| `bugfixes/`  | `fix:` commits      | Correcting broken behavior, visual bugs, logic errors    |
| `hotfixes/`  | `hotfix:` commits   | Urgent production fixes that bypass normal flow          |
| `refactors/` | `refactor:` commits | Restructuring without behavior change, tech debt cleanup |
| `chores/`    | `chore:` commits    | Deps, CI, tooling, config, documentation                 |

---

## Registered Projects

| Short Name | Repository     | Submodule Mount Path | Added       |
| ---------- | -------------- | -------------------- | ----------- |
| `EBP`      | EverBetter-Pro | `docs/plans-EBP`     | 2026-03-26  |

> When onboarding a new repo, add a row here. See [Onboarding a New Repo](#onboarding-a-new-repo).

---

## File Naming Convention

```
plan-<TICKET>-<short-kebab-description>.md
```

- **TICKET** = Jira ticket ID (e.g., `EBP-1836`, `EBT-420`)
- **Description** = 2-6 words in kebab-case summarizing the plan
- **Extension** = always `.md`

### Examples

```
plan-EBP-1836-fix-treatments-hover-buttons.md
plan-EBP-2001-add-patient-timeline-v2.md
plan-EBT-500-hotfix-auth-redirect.md
plan-no-ticket-refactor-sheet-registry.md
```

> If there is no Jira ticket, use `no-ticket` in place of the ticket ID.

---

## Plan Document Structure

Every plan file **must** follow this structure. Copy [TEMPLATE.md](TEMPLATE.md) to get started.

### Required Sections

#### Frontmatter (top of file)

```markdown
# Plan: <Title (2-10 words)>

**Ticket:** <JIRA ticket ID or "N/A">
**Type:** feature | bugfix | hotfix | refactor | chore
**Status:** draft | in-review | approved | in-progress | completed | abandoned
**Author:** <GitHub username>
**Date:** <YYYY-MM-DD>
**Target Repo:** <repo name>
```

#### Status Lifecycle

```
draft → in-review → approved → in-progress → completed
                                            → abandoned
```

| Status        | Meaning                                          |
| ------------- | ------------------------------------------------ |
| `draft`       | Initial write-up, may be incomplete              |
| `in-review`   | PR open in AI-Plans-FE for team review           |
| `approved`    | Reviewed and accepted, ready to implement        |
| `in-progress` | Active development underway                      |
| `completed`   | Implementation done, verified, and merged        |
| `abandoned`   | Plan dropped — document reason in Decisions      |

#### Body Sections

| Section                    | Required | Purpose                                           |
| -------------------------- | -------- | ------------------------------------------------- |
| **Problem**                | Yes      | What's broken/missing and why it matters           |
| **Approach**               | Yes      | High-level strategy (2-5 sentences)                |
| **Steps**                  | Yes      | Numbered implementation steps with file paths      |
| **Relevant Files**         | Yes      | Exact file paths + what to modify                  |
| **Verification**           | Yes      | Specific checks to confirm correctness             |
| **Decisions**              | No       | Key trade-offs, excluded scope, alternatives       |
| **Implementation References** | Yes*  | Commit SHAs and PR link (*filled when completed)  |

#### Implementation References

This section links the plan back to the actual code. Fill it in as you implement:

```markdown
## Implementation References

| Commit SHA | Repo            | Branch                      | Description              |
| ---------- | --------------- | --------------------------- | ------------------------ |
| `abc1234`  | EverBetter-Pro  | `feature/EBP-1836-...`      | Initial implementation   |
| `def5678`  | EverBetter-Pro  | `feature/EBP-1836-...`      | Code review fixes        |

**PR:** https://github.com/MaxwellClinic-Development/EverBetter-Pro/pull/123
```

> This is the key traceability link: **plan → commits → PR → merged code**.

---

## Workflow

1. **Create** — Copy `TEMPLATE.md` into the appropriate `<PROJECT>/<category>/` folder. Name it per the naming convention. Set status to `draft`.
2. **Review** (optional) — Open a PR in AI-Plans-FE. Set status to `in-review`. Team reviews the plan, not code.
3. **Approve** — Merge the plan PR (or self-approve for small plans). Set status to `approved`.
4. **Implement** — Set status to `in-progress`. Build the feature/fix in the target repo.
5. **Record** — As you commit code, add commit SHAs to the Implementation References table.
6. **Complete** — When the target repo PR is merged, set status to `completed`. Add the PR link.
7. **Sync** — Push plan changes to AI-Plans-FE, then update the submodule pointer in the target repo.

### Updating Plan Status

```bash
cd docs/plans-EBP
# Edit the plan file — update Status and Implementation References
git add . && git commit -m "docs(EBP): update plan-EBP-1836 status to completed"
git push origin main
cd ../..
git add docs/plans-EBP
git commit -m "chore: update AI-Plans-FE submodule ref"
```

---

## Syncing Plans with the Parent Repo

When plans change, the submodule SHA pointer in the parent repo must be updated so the whole team stays in sync.

### Manual Workflow

```bash
# 1. Push changes inside the submodule
cd docs/plans-EBP
git add . && git commit -m "feat(EBP): add plan for EBP-1234"
git push origin main

# 2. Update the pointer in the parent repo
cd ../..
git add docs/plans-EBP
git commit -m "chore: update AI-Plans-FE submodule ref"
```

### EverBetter-Pro Shortcut

```bash
yarn sync-plans
```

This script auto-commits + pushes submodule changes, then updates the pointer in the parent repo.

### Pulling Latest Plans

```bash
# One-time global setting (recommended)
git config --global submodule.recurse true

# Or per-pull
git pull --recurse-submodules
```

---

## Onboarding a New Repo

1. **Register** — Add a row to the [Registered Projects](#registered-projects) table above.
2. **Create folders** — Add `<SHORT_NAME>/{features,bugfixes,hotfixes,refactors,chores}/` with `.gitkeep` files.
3. **Add submodule** in the consuming repo:
   ```bash
   git submodule add https://github.com/MaxwellClinic-Development/AI-Plans-FE.git <mount-path>
   ```
4. **Commit** `.gitmodules` and the gitlink in the consuming repo.
5. **Document** the submodule setup in the consuming repo's `CONTRIBUTING.md`.

---

## Tips

- Keep plans **focused** — one plan per ticket/change. Don't bundle unrelated work.
- Write the plan **before** coding. It's a thinking tool, not just documentation.
- Update the plan **as you go** — steps may change during implementation. That's fine.
- Use **file paths with line numbers** in Steps and Relevant Files for precision.
- Plans are **living documents** — they evolve from draft through completion.
- **Abandoned plans are valuable** — they document what was considered and why it was dropped.
