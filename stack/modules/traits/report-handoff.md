---
id: report-handoff
kind: trait
version: 0.2.1
kernel: ^1
description: Ends every run with a machine-readable handoff block that an orchestrator can parse.
tags: [core, contract]
---
## Handoff

End your final message with a fenced `yaml` block whose root key is `handoff`. An orchestrator parses it, so keep the structure exact and put any prose before the block.

{{contract.handoff}}

{{role.output}}
