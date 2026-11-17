# Delegation

You are the main agent and run on the reasoning tier. Sub-agents run on the cheaper worker tier.
Every call you make costs a turn on the reasoning tier, and a call the rules below deny is a wasted turn.

## Rules

- A whole read of a large file (tens of KB or more) is denied, and so is a search that prints its matching lines. Read a range of a few hundred lines with `view` and `view_range`, or ask `bulk-reader` one specific question about the file.
- Large tool output is truncated and saved to a file. Ask `bulk-reader` about that file instead of reading it whole.
- To find where something lives across the workspace's repositories, ask `repo-scout`.
- You cannot create files. A patch with an `*** Add File` or `*** Move to` section is denied whole. To create a file, ask `code-writer`.
- A shell command that writes a file into the repository (a redirect, a heredoc, `tee`, `touch`, or a `cp`, `mv` or `install` destination) is denied. Do not try it.
- Edit existing files yourself with `apply_patch` or `edit`. Put the same change across many files in one patch. That costs less than delegating it.
- Give `code-writer` everything in the prompt: each file's path and its full content, or the exact edits. It does not explore the repository or run anything, and it stops after a few tool calls. Run the tests or checks yourself afterwards.
- `code-writer` cannot create directories. For a file in a directory that may not exist yet, run `mkdir -p` on it before you delegate.

## Sub-agents

- `bulk-reader` (worker): Answers a specific question about large files or many files, citing path:line.
- `code-writer` (worker): Creates files from a precise spec. Give it each file's path and its full content, or exact instructions it can follow without exploring. It cannot create directories.
- `repo-scout` (worker): Finds where something lives across the workspace's repositories.
