# Commit Memory MCP - Implementation Tracker

Last Updated: 2026-03-30

## Goal
Replace legacy commit-only tooling with a worktree-aware PR intelligence MCP focused on who changed what and why.

## Status Legend
- [ ] Not started
- [~] In progress
- [x] Done

## Work Items
- [x] Foundation schema/types for PR + worktree session support
- [ ] GitHub PR ingest service (description/comments/reviews)
- [ ] Decision promotion pipeline (Decision/Blocker extraction)
- [ ] Worktree discovery and session sync
- [ ] MCP breaking-change tool migration (remove old tools, add new tools)
- [ ] CLI sync commands for pre-plan workflows
- [ ] Search/ranking updates for author + intent context
- [ ] Update all .github docs for new tool contract
- [ ] Update root docs (README, SETUP) with migration and workflow

## Conventional Commit Plan
- [x] feat(db): add pr, review, decision, and worktree session schema
- [ ] feat(ingest): add github pr description/comments/reviews sync pipeline
- [ ] feat(mcp): replace legacy tools with author-intent and pre-plan sync tools
- [ ] feat(worktree): add multi-worktree session discovery and resume briefs
- [ ] feat(search): add hybrid ranking across commits and promoted pr decisions
- [ ] docs(github): update all .github docs to new tool contract
- [ ] docs(setup): add sync-before-plan workflow and migration guide
- [ ] chore(tracking): maintain implementation tracker

## Notes
- Old tools will be removed (breaking change) once replacement tools are wired.
- PR description is canonical source of "why". Comments are discussion until promoted as decisions.
