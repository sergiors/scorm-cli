# SCORM CLI

Build SCORM 1.2 packages from authored MDX courses.

## Packages

- `@scorm-cli/core` — shared course model and renderer contracts.
- `@scorm-cli/parser` — validates and parses a course into that model.
- `@scorm-cli/renderer-react` — renders the model as a static course player.
- `@scorm-cli/scorm` — packages rendered output as SCORM 1.2.
- `@scorm-cli/cli` — command-line build interface.

## Author a course

A course directory contains an `index.mdx` entry file and item MDX files. The entry file has `title` frontmatter and declares its structure with `<Item>` and nested `<Section>` components:

```mdx
---
title: My Course
---

<Item src="lessons/intro.mdx" />

<Section title="Lessons" layout="grid" columns={2}>
  <Item src="lessons/one.mdx" />
  <Item src="lessons/two.mdx" />
</Section>
```

Each item file requires `title` frontmatter and can contain Markdown plus the supported static components such as `<Image>`, `<Video>`, and `<Question>` with `<Answer>` children. MDX JavaScript and imports are not supported; course files are parsed as data and never execute author code.

## Install and build

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm scorm build examples/typescript-course
```

The example build writes `dist/typescript-course.zip` by default. Pass `--output <path>` to choose a different ZIP path.

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE.md) for details.
