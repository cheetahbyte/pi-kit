# Changelog

## Unreleased

- Add `pi-background-shell`: the `bash_background`, `bash_output`, and `bash_kill` tools, an exit message that resumes the agent, `/bg`, and a `background_shell` footer widget.
- Remove the `claude-usage` status from `pi-claude-code`; `/claude-usage` still lists the plan limits.
- Replace TypeBox schemas and validation tests with `@earendil-works/pi-schema` in the questionnaire, todo, and web packages.
- Remove the `pi-hot-compact` package and its kit registration.
- Preserve existing parameter constraints and support for extra object properties.
- Remove the bundled `@cheetahbyte/pi-subagents` package and its skills.
- Require Pi 1.5.0 or newer for the kit and these three packages.
