# SCORM CLI

Build SCORM 1.2 packages from authored MDX content packages.

## Packages

- `@scorm-cli/core` — shared content package model and renderer contracts.
- `@scorm-cli/parser` — validates and parses authored content into that model.
- `@scorm-cli/renderer-react` — renders the model as a static content player.
- `@scorm-cli/scorm` — packages rendered output as SCORM 1.2.
- `@scorm-cli/cli` — command-line build and development preview interface.

## Author a content package

A content package directory contains an `index.mdx` root document and referenced MDX documents. The root requires `title` frontmatter and exactly one presentation: a `<Scroll>` containing direct `<Page>` references, or a `<Grid>` containing direct `<Item>` references. These modes cannot be mixed; root Markdown, text, and other components are not allowed. A grid may set `columns` to an integer from 1 to 12:

```mdx
---
title: My Scroll Package
---

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

<Grid columns={2}>
  <Item src='practice/check.mdx' />
  <Item src='practice/recall.mdx' />
</Grid>
```

Every referenced Page or Item document requires title-only frontmatter and can contain Markdown plus supported static components such as `<Image>`, `<Video>`, and `<Questionnaire>`. A questionnaire contains one or more `<Question>` elements, each with `<Prompt>` and `<Option>` children. MDX JavaScript and imports are not supported; content files are parsed as data and never execute author code.

```mdx
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

## Install and build

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Example packages

The examples demonstrate the supported package presentations and content components:

| Package                             | What it demonstrates                                                                                | Build                                                | Preview                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `examples/typescript-content`       | A Scroll course with Markdown, a local image, a video reference, code samples, and questionnaires.  | `pnpm scorm build examples/typescript-content`       | `pnpm scorm dev examples/typescript-content`       |
| `examples/typescript-grid`          | A two-column Grid of short practice items using Markdown.                                           | `pnpm scorm build examples/typescript-grid`          | `pnpm scorm dev examples/typescript-grid`          |
| `examples/accessibility-basics`     | A Scroll course with practical accessibility guidance and a knowledge-check questionnaire.          | `pnpm scorm build examples/accessibility-basics`     | `pnpm scorm dev examples/accessibility-basics`     |
| `examples/nr-01-disposicoes-gerais` | A short Scroll pocket guide to NR-01 with practical risk-prevention guidance and a knowledge check. | `pnpm scorm build examples/nr-01-disposicoes-gerais` | `pnpm scorm dev examples/nr-01-disposicoes-gerais` |

Builds write `dist/<content-name>.zip` by default (for example, `dist/accessibility-basics.zip`). Pass `--output <path>` to choose a different ZIP path. `scorm dev <content>` starts a local preview, watches the content directory, and reports validation errors without stopping the preview. Pass `--port <port>` to choose the preview port.

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE.md) for details.
