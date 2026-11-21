import type { AgentSourceLayer, CustomizationKind, CustomizationLocation } from "@pica/protocol";

// How a location holds its items:
// - `agent-files`: `<name>.md` (or `<name>.agent.md`) files in a folder (C-02);
// - `skill-folders`: one folder per skill holding `SKILL.md`;
// - `instruction-files`: `<name>.instructions.md` files in a folder;
// - `single-file`: the location is one instructions file.
export type LocationLayout = "agent-files" | "skill-folders" | "instruction-files" | "single-file";

export interface LocationSpec extends CustomizationLocation {
  readonly layout: LocationLayout;
  // The C-02 layer an agent file here is validated in.
  readonly agentLayer?: AgentSourceLayer;
  // The suffix of a new item's file name, after its name.
  readonly newFileSuffix: string;
}

export interface CustomizationRepoRoot {
  readonly id: string;
  // Null for a repo with no checkout yet: its locations are listed but not read or written.
  readonly root: string | null;
}

// Where each layer's files are, as the composition finds them.
export interface CustomizationRoots {
  readonly builtinAgents: string;
  readonly userAgents: string;
  readonly userSkills: string;
  readonly userInstructions: string;
  readonly workspace?: { readonly id: string; readonly agentsDir: string };
  readonly repo?: CustomizationRepoRoot;
}

interface RepoLocation {
  readonly id: string;
  readonly label: string;
  readonly relative: string;
  readonly layout: LocationLayout;
  readonly agentLayer?: AgentSourceLayer;
  readonly newFileSuffix: string;
}

// Lowest precedence first, within a repo too. `.pica/agents` beats `.github/agents` as in C-02;
// `.github/skills` beats `.claude/skills`, since `.github` is the Copilot runtime's own folder.
const repoLocations: Readonly<Record<CustomizationKind, readonly RepoLocation[]>> = {
  agent: [
    { id: "github-agents", label: ".github/agents", relative: ".github/agents", layout: "agent-files", agentLayer: "github_agents", newFileSuffix: ".agent.md" },
    { id: "pica-agents", label: ".pica/agents", relative: ".pica/agents", layout: "agent-files", agentLayer: "repo", newFileSuffix: ".md" },
  ],
  skill: [
    { id: "claude-skills", label: ".claude/skills", relative: ".claude/skills", layout: "skill-folders", newFileSuffix: "/SKILL.md" },
    { id: "github-skills", label: ".github/skills", relative: ".github/skills", layout: "skill-folders", newFileSuffix: "/SKILL.md" },
  ],
  instructions: [
    { id: "agents-md", label: "AGENTS.md", relative: "AGENTS.md", layout: "single-file", newFileSuffix: "" },
    { id: "copilot-instructions", label: ".github/copilot-instructions.md", relative: ".github/copilot-instructions.md", layout: "single-file", newFileSuffix: "" },
    { id: "github-instructions", label: ".github/instructions", relative: ".github/instructions", layout: "instruction-files", newFileSuffix: ".instructions.md" },
  ],
};

export function customizationLocations(
  kind: CustomizationKind,
  roots: CustomizationRoots,
  lockedBy: string | undefined,
): LocationSpec[] {
  const lock = lockedBy === undefined ? {} : { lockedBy };
  const local = (spec: Omit<LocationSpec, "kind" | "repoId" | "singleFile" | "lockedBy">): LocationSpec => ({
    ...spec,
    kind,
    repoId: null,
    singleFile: spec.layout === "single-file",
    ...(spec.writable ? lock : {}),
  });
  const specs: LocationSpec[] = [];
  if (kind === "agent") {
    specs.push(local({ id: "builtin", layer: "builtin", label: "Built-in agents", path: roots.builtinAgents, writable: false, layout: "agent-files", agentLayer: "builtin", newFileSuffix: ".md" }));
    specs.push(local({ id: "user", layer: "user", label: "Your agents", path: roots.userAgents, writable: true, layout: "agent-files", agentLayer: "user", newFileSuffix: ".md" }));
    if (roots.workspace !== undefined) {
      specs.push(local({ id: "workspace", layer: "workspace", label: "Workspace agents", path: roots.workspace.agentsDir, writable: true, layout: "agent-files", agentLayer: "workspace", newFileSuffix: ".md" }));
    }
  } else if (kind === "skill") {
    specs.push(local({ id: "user", layer: "user", label: "~/.copilot/skills", path: roots.userSkills, writable: true, layout: "skill-folders", newFileSuffix: "/SKILL.md" }));
  } else {
    specs.push(local({ id: "user", layer: "user", label: "~/.copilot/copilot-instructions.md", path: roots.userInstructions, writable: true, layout: "single-file", newFileSuffix: "" }));
  }
  const repo = roots.repo;
  if (repo?.root != null) {
    const root = repo.root;
    for (const entry of repoLocations[kind]) {
      specs.push({
        id: `repo:${repo.id}:${entry.id}`,
        kind,
        layer: "repo",
        label: entry.label,
        repoId: repo.id,
        path: `${root}/${entry.relative}`,
        singleFile: entry.layout === "single-file",
        writable: true,
        layout: entry.layout,
        newFileSuffix: entry.newFileSuffix,
        ...(entry.agentLayer === undefined ? {} : { agentLayer: entry.agentLayer }),
        ...lock,
      });
    }
  }
  return specs;
}

export function publicLocation(spec: LocationSpec): CustomizationLocation {
  return {
    id: spec.id,
    kind: spec.kind,
    layer: spec.layer,
    label: spec.label,
    repoId: spec.repoId,
    path: spec.path,
    singleFile: spec.singleFile,
    writable: spec.writable,
    ...(spec.lockedBy === undefined ? {} : { lockedBy: spec.lockedBy }),
  };
}
