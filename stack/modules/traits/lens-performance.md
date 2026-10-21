---
id: lens-performance
kind: trait
version: 0.1.0
kernel: ^0.6
description: Review focus on work, waits and resources that grow with real data and usage.
applies_to: [verifier]
slot: lens
tags: [core, lens]
---
## Focus: performance

- Work done more often than needed: queries or requests inside loops (N+1), recomputation in hot paths or in render and build methods, missing caching where the data is stable.
- Growth: algorithms or data structures that slow down at realistic sizes; unbounded lists; missing pagination or batching.
- Waiting: blocking I/O on the main or UI thread, sequential calls that could run concurrently, oversized payloads.
- Resources: listeners, timers, streams, controllers or connections that are never released; caches that never evict.

For each finding, state the size or frequency at which it starts to matter, and measure when you can.
