# SCORM CLI

Build SCORM 1.2 packages from authored MDX content, with a local preview server.

## Install and use

The published package is `scorm-cli`. It requires Node.js `>=20.19.0`.

```sh
# Build a SCORM 1.2 ZIP (writes dist/<content-name>.zip by default)
npx scorm-cli build ./content

# Choose the output path
npx scorm-cli build ./content --output ./build/course.zip

# Preview with a live-reloading dev server
npx scorm-cli dev ./content --port 5173
```

`scorm-cli build` parses the content package, renders the static player, and writes a SCORM 1.2 ZIP.
`scorm-cli dev` serves the same player with a mock LMS API, reloads as the content changes, and
reports validation errors without stopping the preview.

## Author a content package

A content package directory contains an `index.mdx` root document and referenced MDX documents. Components are imported from the typed `scorm-cli/authoring` subpath so editors can complete names and check props. The import is inert: the CLI resolves the named bindings (and aliases) to its canonical vocabulary while parsing, but content files are parsed as data and never executed. Imports from other modules are ignored, and MDX JavaScript is not supported.

The root requires `title` frontmatter and exactly one presentation: a `<Scroll>` containing direct `<Page>` references, or a `<Grid>` containing direct `<Item>` references. These modes cannot be mixed; root Markdown, text, and other components are not allowed. A grid may set `columns` to an integer from 1 to 12:

```mdx
---
title: My Scroll Package
---

import { Scroll, Page } from 'scorm-cli/authoring';

<Scroll>
  <Page src='lessons/intro.mdx' />
  <Page src='lessons/one.mdx' />
  <Page src='lessons/two.mdx' />
</Scroll>
```

Grid packages use the same exact-one-root rule and reference item documents:

```mdx
---
title: Practice Package
---

import { Grid, Item } from 'scorm-cli/authoring';

<Grid columns={2}>
  <Item src='practice/check.mdx' />
  <Item src='practice/recall.mdx' />
</Grid>
```

Every referenced Page or Item document requires title-only frontmatter and can contain Markdown plus supported static components such as `<Image>`, `<Video>`, and `<Questionnaire>`. A Page can also include a `<Path>` whose `<Page ref='...' />` children point at pages already declared in the root `<Scroll>`. MDX JavaScript is not supported.

```mdx
import { Questionnaire, Question, Prompt, Option } from 'scorm-cli/authoring';

<Questionnaire>
  <Question type='single-choice'>
    <Prompt>What does TypeScript add to JavaScript?</Prompt>
    <Option value='runtime' correct={false}>
      A separate runtime
    </Option>
    <Option value='types' correct={true}>
      Static types and tooling
    </Option>
  </Question>
</Questionnaire>
```

Paths reference pages that the root `<Scroll>` already declares:

```mdx
import { Path, Page } from 'scorm-cli/authoring';

<Path>
  <Page ref='lessons/one.mdx' />
  <Page ref='lessons/two.mdx' />
</Path>
```

## Development

This repository is a pnpm workspace that produces a single published package, `scorm-cli`. Every
other package is private and bundled into that executable at build time, so the published artifact
never depends on a workspace package. The private packages are declared as the CLI's
`devDependencies`, so `pnpm build` (a pnpm recursive, filtered dependency-graph build) builds them
before the CLI. Authoring markers are exposed publicly only through the `scorm-cli/authoring`
subpath.

| Workspace package            | Role                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `packages/cli` (`scorm-cli`) | Public package: CLI, preview server, and the `authoring` subpath.  |
| `@scorm-cli/core`            | Shared content package model and renderer contracts.               |
| `@scorm-cli/parser`          | Validates and parses authored content into that model.             |
| `@scorm-cli/renderer-react`  | Renders the model as a static content player.                      |
| `@scorm-cli/scorm`           | Packages rendered output as SCORM 1.2.                             |
| `@scorm-cli/authoring`       | Authoring marker vocabulary, re-exported as `scorm-cli/authoring`. |

Authored MDX flows through the parser into the renderer-independent canonical model. The React
renderer builds the player; the SCORM package bundles that output; the CLI coordinates build and
preview workflows. Dependencies point toward the shared core model: core does not depend on React, the
parser does not depend on the renderer, and the renderer consumes parsed content rather than
parsing MDX. The player keeps semantic progress separate from the SCORM suspend-data codec, while
package generation owns the SCORM manifest and archive format.

```sh
pnpm install
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

### Example packages

The examples demonstrate the supported package presentations and content components:

| Package                             | What it demonstrates                                                                                | Build                                                | Preview                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `examples/typescript-content`       | A Scroll course with Markdown, a local image, a video reference, code samples, and questionnaires.  | `pnpm scorm build examples/typescript-content`       | `pnpm scorm dev examples/typescript-content`       |
| `examples/typescript-grid`          | A two-column Grid of short practice items using Markdown.                                           | `pnpm scorm build examples/typescript-grid`          | `pnpm scorm dev examples/typescript-grid`          |
| `examples/accessibility-basics`     | A Scroll course with practical accessibility guidance and a knowledge-check questionnaire.          | `pnpm scorm build examples/accessibility-basics`     | `pnpm scorm dev examples/accessibility-basics`     |
| `examples/nr-01-disposicoes-gerais` | A short Scroll pocket guide to NR-01 with practical risk-prevention guidance and a knowledge check. | `pnpm scorm build examples/nr-01-disposicoes-gerais` | `pnpm scorm dev examples/nr-01-disposicoes-gerais` |

Builds write `dist/<content-name>.zip` by default (for example, `dist/accessibility-basics.zip`). Pass `--output <path>` to choose a different ZIP path. `pnpm scorm dev <content>` starts a local preview, watches the content directory, and reports validation errors without stopping the preview. Pass `--port <port>` to choose the preview port.

### Publishing

`packages/cli` is the published package: `pnpm build` runs the CLI's dependency graph (the private
workspace packages are declared as the CLI's devDependencies, so `pnpm --filter scorm-cli... build`
builds them first) and writes the bundled CLI, the player app, and the authoring declarations in
place. `npm publish` then runs directly in that directory — there is no separate staging or manifest
assembly step. The `version` in `packages/cli/package.json` is the only source of the published
version; it is never bumped automatically.

Publishing runs in the `Publish` workflow (`.github/workflows/publish.yml`) on every push to `main`.
It installs, tests, and builds the package, then skips successfully when `scorm-cli@<version>`
already exists on npm and otherwise publishes through
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no token is stored in
the repository. Configure the trusted publisher in the npm UI for package `scorm-cli`, GitHub
repository `sergiors/scorm-cli`, and workflow file `publish.yml`.

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE.md) for details.
