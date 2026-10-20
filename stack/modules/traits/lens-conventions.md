---
id: lens-conventions
kind: trait
version: 0.1.0
kernel: ^0.3
description: Review focus on fit with this project's own conventions rather than general taste.
applies_to: [verifier]
slot: lens
tags: [core, lens]
---
## Focus: conventions

Judge the change against this project, not general taste:

- Find the rules first: the project's docs and instruction files, linter and formatter config, and how similar code nearby is written.
- Structure and layering: code sits in the right module or layer, and dependencies point the allowed way.
- Naming, file layout, error handling, logging and test style match the surrounding code.
- Reuse: an existing helper, component or pattern should have been used instead of a new one.
- Generated files, lockfiles or config edited by hand when they should not be.

Cite the convention you rely on (a written rule, or two existing examples) for every finding.
