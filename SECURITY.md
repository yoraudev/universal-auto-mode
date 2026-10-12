# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately, not in a public issue.

Open the repository's **Security** tab on GitHub and click **Report a vulnerability**. This sends a private report that only the maintainer can see.

Include what you can of the following:

- what the vulnerability allows an attacker to do
- the steps or a proof of concept to reproduce it
- the release version, the harness and its version, the classifier model (`base` or `small`) and the operating system you tested with

You will get a reply once the report has been reviewed. Please give the maintainer a reasonable amount of time to release a fix before disclosing the issue publicly.

## Supported versions

Only the latest release receives security fixes.

## What counts as a vulnerability

Examples of issues that should be reported:

- an action that [docs/policy.md](docs/policy.md) lists as `critical` being approved without asking the user
- a command or path that reaches credentials, the network or files outside the project while being rated `low` or `medium`, where the rating is wrong because of how the command is parsed
- tool output changing or resetting the session score without the model taking an action, for example by making the daemon skip a scan
- an adapter approving an action when the daemon answered `ask`, or overriding a `deny` from the harness
- a web page or another origin reaching the daemon's HTTP endpoints from a browser

## What does not

The following are known properties of the tool, described in the [README](README.md), and are not treated as vulnerabilities:

- the classifier missing an injection, or flagging harmless text
- a model following an injection and taking actions that are rated `low`, or that the user then approves
- actions rated `medium` or `high` being approved in a session where nothing was flagged
- other software running under the same user account calling the local daemon, including to clear a session's flags or change its settings
