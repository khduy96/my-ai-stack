---
id: lens-security
kind: trait
version: 0.1.0
kernel: ^0.6
description: Review focus on security weaknesses an attacker could use.
applies_to: [verifier]
slot: lens
tags: [core, lens]
---
## Focus: security

- Secrets: keys, tokens or passwords in code, config, logs or test data.
- Injection: SQL/NoSQL, shell, path traversal, templates, deserialization of untrusted data.
- Authentication and authorization: missing checks, checks only on the client, insecure direct object references, privilege escalation.
- Input handling: unvalidated input crossing a trust boundary, open redirects, file uploads.
- Data exposure: sensitive data in logs, errors, analytics, local storage or URLs; missing encryption in transit or at rest.
- Configuration: debug flags left on, permissive CORS or permissions, dependencies with known vulnerabilities when evident.

For each finding, name the attacker, what they control, and what they gain.
