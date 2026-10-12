# scorm-cli

Build SCORM 1.2 or SCORM 2004 packages from authored MDX content, with a local preview server.

## Requirements

- Node.js `>=20.19.0`.

## Usage

```sh
# Build a SCORM 1.2 ZIP (writes dist/<content-name>.zip by default)
npx scorm-cli build ./content

# Choose the output path
npx scorm-cli build ./content --output ./build/package.zip

# Build a SCORM 2004 package (SCORM 1.2 is the default)
npx scorm-cli build ./content --scorm 2004

# Preview with a live-reloading local server
npx scorm-cli preview ./content --port 5173
```

`build` parses the content package, renders the static player, and writes a SCORM 1.2 ZIP by default.
Use `--scorm 2004` to create a SCORM 2004 ZIP.
`preview` serves the same player with a mock LMS API and reloads as the content changes, reporting
validation errors without stopping the preview.
Preview uses the existing SCORM 1.2 development bridge; it does not emulate a SCORM 2004 LMS.

## Authoring

Content packages declare their structure and components with typed markers imported from the
`scorm-cli/authoring` subpath:

```mdx
---
title: My Scroll Package
---

import { Scroll, Page } from 'scorm-cli/authoring'

<Scroll>
  <Page src="lessons/intro.mdx" />
  <Page src="lessons/one.mdx" />
</Scroll>
```

The import is inert: the CLI resolves the named bindings (and aliases) while parsing, but content
files are parsed as data and never executed. See the repository `README` for the full authoring
reference.

The authoring declarations reference React types, so `@types/react` is declared as an optional peer
dependency: it is never installed automatically, but a project that provides it (as React projects
already do) gets full type checking for the `scorm-cli/authoring` markers.

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE.md) for details.
