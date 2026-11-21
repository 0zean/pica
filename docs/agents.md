# Agents, skills and rules (X-02)

Window ▸ Agents & Skills (⇧⌘A, `showCustomization` in A-14's registry) lists the custom agents, skills and instruction
files Pica and the Copilot runtime read, from every layer of a chosen scope, says where each comes from and which one
applies, and edits them. It is a window of its own, like MCP Servers (A-13), not a Settings pane: Settings edits one
file in a fixed form and knows no workspace or repo, while these are many files at four layers that need a list and an
editor side by side.

The feature package is `app/Packages/Customization` (lint-arch rule added). The engine side is core
`customization/`, adapters `customization/` and `server/src/customization-handlers.ts`, composed in
`composition-customization.ts`.

## Scope and layers

The scope picker shows **Your files** (built-in and user), a **workspace** (adds its layer), or **workspace › repo**
(adds that repo's folders). A repo's items depend on which repo, so repos are shown one at a time, as a session in that
repo would see them. Locations, lowest precedence first:

| Kind | Built-in | User | Workspace | Repo |
|---|---|---|---|---|
| Agents | `adapters/src/agents/builtin` (read-only) | `~/Library/Application Support/Pica/agents` | `~/Library/Application Support/Pica/workspaces/<id>/agents` | `.github/agents`, then `.pica/agents` |
| Skills | — | `~/.copilot/skills/<name>/SKILL.md` | — | `.claude/skills`, then `.github/skills` |
| Instructions | — | `~/.copilot/copilot-instructions.md` | — | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` |

Agents follow C-02 exactly (PLAN.md §4.6 order; `.pica/agents` over `.github/agents`). Skills and instructions use the
Copilot runtime's own folders (PLAN.md §1.3, existing conventions); `.github/skills` is put over `.claude/skills` in one
repo because `.github` is the runtime's own folder.

## Which one wins

Agents and skills are identified by name (an agent's file name without `.md` / `.agent.md`, a skill's folder). Of the
files with one name, the one in the highest location **wins**; the others are **overridden by** it, and the row names the
winner's source. This is C-02's `resolveAgents` rule, and `customization.test.ts` checks that the winners are exactly
the agents `MarkdownAgentLoader` resolves for the same layers. A file that does not validate is **invalid**, shows its
problems with the field named, and takes no part; the same name twice in one location makes the second invalid, as in
C-02. Instruction files are not chosen between: every one **applies**.

Rows read "<name>, <source>, <status>", for example `reviewer, atlas · .pica/agents, Wins` and
`reviewer, You, Overridden by atlas · .pica/agents`.

## Editing

- **New Agent / Skill / Instructions** opens a sheet: a location (writable ones, highest first), a name (none for a
  single-file location such as `AGENTS.md`), and for agents a description, tier and comma-separated tools, for skills a
  description. `NewItemDraft.text` writes text values as JSON strings, which YAML reads as double-quoted scalars, so
  a colon or quote cannot break the frontmatter.
- The detail pane edits the file's text (⌘S saves), reverts it, or deletes the file (a skill's folder too when left
  empty). Built-in agents are read-only; to change one, create an agent of the same name in a higher layer.
- Nothing is written that would not load: the engine parses the frontmatter with C-02's parser and validates an agent
  with C-02's `validateAgent` in the location's layer (a `.github/agents` file uses Copilot's alias rules), and a skill
  with the Agent Skills rules (`description` required, `name` equal to the folder). A refusal is `config_invalid` with
  `details.problems` naming each field; the sheet shows it and keeps the draft.

## Managed policy

A managed policy (H-01) can lock kinds:

```jsonc
{ "id": "acme", "customization": { "locked": ["agent"] } }
```

Locked kinds are listed with `lockedBy` on every writable location and item; the window disables New, Save and Delete
and shows "Locked by managed policy “acme”". A write is refused by the engine anyway with `policy_denied` and
`details.policy`.

## Protocol

- `customization.list { kind, workspaceId?, repoId? }` → `{ items, locations }`. `repoId` needs `workspaceId`; a repo
  without a checkout contributes no locations. Items are sorted by name, the winner first.
- `customization.create { kind, locationId, name?, text, workspaceId?, repoId? }` → `{ item }`. `already_exists` when a
  file of that name is there (for agents either `x.md` or `x.agent.md`).
- `customization.save { kind, path, text, … }` → `{ item }` and `customization.delete { kind, path, … }`. `path` must be
  an item that `customization.list` returns for the same kind and scope, so no other file can be read or written.

## What applies to sessions

Listing a layer is not the same as a session using it: sessions are still built with the built-in and user agents only,
loaded when the engine starts (C-02, A-06), so an agent created or edited here applies to new sessions after Pica
restarts, and workspace and `.pica/agents` agents are not given to sessions yet. Repo `.github/agents`, skills and
instruction files are read by the Copilot runtime itself in the session's directory. Composing the workspace and repo
agent layers per session, and reloading agents without a restart, are follow-ups.

## Testing

- Engine: `core/tests/customization/resolve.test.ts` (precedence, invalid and duplicate files, instructions) and
  `server/tests/customization/customization.test.ts` over the production composition, including the X-02 check that an
  agent created from the UI's text (`fixtures/customization/ui-agent.md`) loads with `MarkdownAgentLoader`.
- App: `AgentDraftTests` checks the New Agent sheet's text equals that fixture; `CustomizationStoreTests` checks the
  source and status of each row, the order of new-item locations, and the lock.
- UI: `CustomizationUITests` creates an agent in the window, checks the file, relaunches and finds it in `agents.list`
  (the engine does not start on an agent its loader rejects); checks each row's layer and winner as the scope changes
  from Your files to a repo; and checks a managed lock disables editing and names the policy.
