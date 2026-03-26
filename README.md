# AI-Plans-FE

Centralized plan storage for MaxwellClinic frontend repositories. Each project gets a top-level folder. Plans are consumed via git submodules — **plan files are never committed to consuming repos**, only the submodule SHA pointer is.

---

## Structure

```
AI-Plans-FE/
├── README.md          # This file
├── CONVENTION.md      # Plan writing convention & rules
├── TEMPLATE.md        # Blank plan template — copy when starting a new plan
└── <PROJECT>/         # One folder per consuming repo
    ├── features/
    ├── bugfixes/
    ├── hotfixes/
    ├── refactors/
    └── chores/
```

## Registered Projects

| Short Name | Repository     | Submodule Mount Path |
| ---------- | -------------- | -------------------- |
| `EBP`      | EverBetter-Pro | `docs/plans-EBP`     |

> To onboard a new repo, see [CONVENTION.md](CONVENTION.md#onboarding-a-new-repo).

---

## Quick Start

### As a consuming repo developer

```bash
# First-time clone (auto-pulls submodule)
git clone --recurse-submodules <repo-url>

# Existing clone — init the submodule
git submodule update --init --recursive

# Auto-pull plans on every git pull (set once)
git config --global submodule.recurse true
```

### Creating a plan

```bash
cd docs/plans-EBP                             # Enter the submodule
cp ../../TEMPLATE.md EBP/features/plan-EBP-1234-my-feature.md
# Edit the plan...
git add . && git commit -m "feat(EBP): add plan for EBP-1234"
git push origin main
cd ../..                                       # Back to parent repo
git add docs/plans-EBP                         # Stage updated submodule pointer
git commit -m "chore: update AI-Plans-FE submodule ref"
```

### Syncing (EverBetter-Pro shortcut)

```bash
yarn sync-plans
```

---

## Convention

See [CONVENTION.md](CONVENTION.md) for full details on:

- Folder structure & naming
- File naming convention
- Required plan sections
- Workflow (draft → completed)
- Implementation references (linking plans to commits)
- Onboarding new repos
