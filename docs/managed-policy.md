# Managed policy (H-01)

An organization restricts Pica with one managed policy. No user, workspace or repo setting can loosen it.

## Where it is read from

In order; the first trusted source wins and any later source that exists is reported as shadowed:

1. Managed preferences for the domain `dev.pica.Pica`, as installed by an MDM profile: `/Library/Managed Preferences/dev.pica.Pica.plist`, then `/Library/Managed Preferences/<user>/dev.pica.Pica.plist`.
2. The policy file `/Library/Application Support/Pica/policy.jsonc` (JSONC, same keys).

A source is trusted only when root owns both the file (after following symlinks) and its directory, and neither is writable by group or others. An untrusted source is skipped with a `managed_policy.untrusted_file` warning. A trusted source that fails to parse or validate is an error: the engine does not run without the restrictions.

## Keys

```jsonc
{
  "id": "acme",                                   // names the policy in decisions: managed:acme.*
  "models": { "allow": ["…"], "deny": ["…"] },    // model ids; a tier naming another model falls back (C-01)
  "mcpServers": { "allow": [{ "id": "github", "url": "https://api.githubcopilot.com/mcp/" }] },
  "budget": { "maxSessionCredits": 500, "maxWorkspaceDailyCredits": 5000 },
  "permissions": { "minimumMode": "ask" },        // the least strict permissions.mode allowed
  "rules": [{ "id": "no-push", "reason": "Pushes go through CI", "kinds": ["shell"], "commandPattern": "^git push" }],
  "config": { "routing": { "profile": "strict" } } // any config.jsonc key; each key set here is locked
}
```

- `models`, `mcpServers` and `rules` compile into `ManagedModelPolicy`, `ManagedMcpAllowlist` (id `<id>.mcp-servers`) and `ManagedRule`s (id `<id>.<rule id>`), which C-01, M-05 and C-03 already enforce.
- Budget ceilings cap the resolved config values, a budget requested in `session.create`, and a raise approved after a budget runs out. A session created without a budget gets the ceiling.
- A value the ceilings or the floor changed is reported by `config.get` as layer `managed`, locked.
