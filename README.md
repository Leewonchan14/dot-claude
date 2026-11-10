# dot-claude

My [Claude Code](https://code.claude.com) setup, packaged as a plugin marketplace.

## Install

```
/plugin marketplace add Leewonchan14/dot-claude
/plugin install my-skills@wonchan
```

Shell equivalent:

```
claude plugin marketplace add Leewonchan14/dot-claude
claude plugin install my-skills@wonchan --scope user
```

## Update

```
/plugin marketplace update wonchan
```

Or turn on auto-update in `/plugin` > Marketplaces > wonchan > Enable auto-update.
Plugins here have no `version` field, so every pushed commit counts as a new version.

## Layout

```
.claude-plugin/marketplace.json      marketplace catalog
plugins/my-skills/
  .claude-plugin/plugin.json         plugin manifest
  skills/<skill-name>/SKILL.md       one folder per skill
```

Skills appear as `/my-skills:<skill-name>`.

## Add a skill

Copy `plugins/my-skills/skills/example/`, rename the folder and the `name` field, write the instructions, then commit and push.
