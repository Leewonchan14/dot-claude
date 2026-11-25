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

On a Mac, also install the macOS-only tools:

```
/plugin install mac-tools@wonchan
```

## Plugins

| Plugin | Where | Skills |
|---|---|---|
| `my-skills` | any machine | `ppt-explain`, `example` |
| `mac-tools` | macOS only | `mail-cli` (mailctl), `mail-archiving`, `slack-cli` (slackctl), `notion-cli` (notionctl), `kakao-cli` (kakaoctl) |

The `mac-tools` skills drive Mail.app, the Slack desktop app and the Notion desktop app, and need macOS
permissions (Full Disk Access, Automation, Accessibility). Their commands live in each skill's `scripts/`
folder. The skills call them by name, so link them onto your PATH from the marketplace clone, which keeps
the same path across updates:

```
for c in mail-cli/scripts/mailctl slack-cli/scripts/slackctl notion-cli/scripts/notionctl kakao-cli/scripts/kakaoctl; do
  ln -sf ~/.claude/plugins/marketplaces/wonchan/plugins/mac-tools/skills/$c ~/.local/bin/
done
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
plugins/mac-tools/                   same layout, macOS-only skills
```

Skills appear as `/my-skills:<skill-name>` and `/mac-tools:<skill-name>`.

## Add a skill

Copy `plugins/my-skills/skills/example/`, rename the folder and the `name` field, write the instructions, then commit and push.
