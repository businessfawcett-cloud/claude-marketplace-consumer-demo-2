# claude-marketplace-consumer-demo-2

POC consumer repo enabling all three plugins (`skill-alpha`, `skill-bravo`,
`skill-charlie`) from
[claude-skill-marketplace-demo-2](https://github.com/businessfawcett-cloud/claude-skill-marketplace-demo-2)
via `.claude/settings.json`, to test whether Claude Code loads multiple plugins
from one marketplace simultaneously.

## Install

```
claude plugin marketplace add businessfawcett-cloud/claude-skill-marketplace-demo-2 --scope project
claude plugin install skill-alpha@claude-skill-marketplace-demo-2 --scope project
claude plugin install skill-bravo@claude-skill-marketplace-demo-2 --scope project
claude plugin install skill-charlie@claude-skill-marketplace-demo-2 --scope project
```

`--scope project` is required explicitly — plugin CLI commands default to
`--scope user`, which silently misses anything declared in a committed
`enabledPlugins`.

See `D:\Internship\Marketplace 2\FINDINGS.md` for the full test history and
results.
