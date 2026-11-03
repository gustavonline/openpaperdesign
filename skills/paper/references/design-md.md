# DESIGN.md

Use [paper-design](../../paper-design/SKILL.md) for design authoring/review and its [design-system guidance](../../paper-design/references/design-system.md) for source, scope and evidence. This reference covers interoperability only.

Keep an existing `DESIGN.md`/`design.md` and its accepted prose. A plain Paper guide works without a compiler, package install or mandatory frontmatter. The Design panel renders that guide and computes In use separately from layer values. Neither reading a guide nor matching a literal colour creates a token binding.

When the user specifically requests the Google DESIGN.md exchange format, inspect its current spec and the selected project's available validator/exporter before normalizing the file. Use named mappings and typed typography groups, retain meaningful prose, and check populated categories actually appear in the export. Report missing validation tooling rather than installing a new dependency implicitly. Keep optional generated token files subordinate to the project's existing source of truth.

The reviewed UI Skills create-design-md method contributes the evidence/scoping approach. Its strict Google-format pipeline is conditional here, so ordinary Paper authoring remains self-contained. Source and licence: [methods](methods.md).
