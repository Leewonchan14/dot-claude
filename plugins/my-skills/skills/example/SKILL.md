---
name: example
description: Template skill for this marketplace. Copy this folder to add a new skill. Only runs when invoked as /my-skills:example.
disable-model-invocation: true
---

# Example skill

This is a placeholder that shows the folder layout. To add a real skill:

1. Copy `plugins/my-skills/skills/example/` to `plugins/my-skills/skills/<new-name>/`.
2. Change `name` and `description` in the frontmatter. The description decides when Claude picks the skill, so say what it does and when to use it.
3. Remove `disable-model-invocation: true` if Claude should be able to run it on its own.
4. Commit and push, then run `/plugin marketplace update wonchan` on each machine.
