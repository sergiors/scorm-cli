# SCORM CLI

Build SCORM 1.2 packages from authored MDX content packages.

## Packages

- `@scorm-cli/core` — shared content package model and renderer contracts.
- `@scorm-cli/parser` — validates and parses authored content into that model.
- `@scorm-cli/renderer-react` — renders the model as a static content player.
- `@scorm-cli/scorm` — packages rendered output as SCORM 1.2.
- `@scorm-cli/cli` — command-line build interface.

## Author a content package

A content package directory contains an `index.mdx` root document and item MDX files. The root has `title` frontmatter and declares its structure with `<Item>` and `<Section>` components. Sections may contain items only; nested sections are not supported. Layout can be `list`, `grid`, or `sequence`. The optional `columns` attribute is only valid with `layout='grid'`. Items default to `open='page'` and may use `open='modal'`:

```mdx
---
title: My Content Package
---

<Item src='lessons/intro.mdx' />

<Section title='Learning path' layout='sequence'>
  <Item src='lessons/one.mdx' />
  <Item src='lessons/two.mdx' />
</Section>

<Section title='Practice' layout='grid' columns={2}>
  <Item src='lessons/check.mdx' open='modal' />
</Section>
```

Each item file requires `title` frontmatter and can contain Markdown plus the supported static components such as `<Image>`, `<Video>`, and `<Question>` with `<Answer>` children. MDX JavaScript and imports are not supported; content files are parsed as data and never execute author code.

## Install and build

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm scorm build examples/typescript-content
```

The example build writes `dist/typescript-content.zip` by default. Pass `--output <path>` to choose a different ZIP path.

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE.md) for details.
