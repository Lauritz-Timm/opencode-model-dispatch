# Security Policy

## Supported Versions

This project is pre-alpha and has no supported production release yet.

## Reporting a Vulnerability

Please report vulnerabilities privately by opening a GitHub security advisory if
available, or by contacting the repository owner directly.

Do not include secrets, API keys, private prompts, or sensitive workspace data in
public issues.

## Privacy Expectations

The planned plugin must avoid logging prompts, task descriptions, user text, or
other sensitive task content. `privacy.logging_enabled: false` is specified to
disable all plugin logging while preserving user-facing warnings and errors.
