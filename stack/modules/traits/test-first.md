---
id: test-first
kind: trait
version: 0.1.0
kernel: ^0.6
description: Writes a failing test before the change, then makes it pass.
applies_to: [builder]
tags: [core, discipline]
---
## Test first

- When the project has a test setup, start by writing or extending a test that fails because of the missing behaviour or the bug, and run it to see it fail.
- Then make the change, and run that test again together with the related existing tests until they pass.
- Report both runs under `checks`. If the project has no test setup, say so in your summary and continue without one.
