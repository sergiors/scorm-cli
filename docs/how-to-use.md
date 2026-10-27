# How to Use scorm-cli

This guide covers the authoring workflow, project structure, component reference, and CLI commands for `scorm-cli`.

## Authoring Workflow

1. **Create a project**: Create a directory for your content.
2. **Configure `index.mdx`**: Define your presentation style and root structure.
3. **Create Pages/Items**: Author individual content files.
4. **Add content**: Use Markdown and supported MDX components.
5. **Add Questionnaires**: Define interactive assessments.
6. **Preview**: Run the local server to verify.
7. **Build**: Generate your SCORM 1.2 or 2004 package.

## Project Structure

A content package must have an `index.mdx` file at the root.

```text
my-course/
  index.mdx
  lessons/
    intro.mdx
    chapter-1.mdx
  assets/
    image.png
```

## Presentations

Your `index.mdx` must contain **exactly one** of these presentations:

### `Scroll`

Continuous, virtualized content. Learners scroll through pages.

```mdx
<Scroll>
  <Page src="lessons/intro.mdx" />
  <Page src="lessons/chapter-1.mdx" />
</Scroll>
```

### `Slides`

Shows one page at a time.

```mdx
<Slides>
  <Page src="lessons/intro.mdx" />
  <Page src="lessons/chapter-1.mdx" />
</Slides>
```

### `Tiles`

A grid of short items.

```mdx
<Tiles columns={2}>
  <Item src="practice/check.mdx" />
  <Item src="practice/recall.mdx" />
</Tiles>
```

## MDX Authoring Rules

- Imports must be from `scorm-cli/authoring`.
- MDX is parsed as data; standard JavaScript in MDX is **not** supported.
- `index.mdx` requires `title` frontmatter.
- Page/Item files require `title` frontmatter.

## Component Reference

Import components from `scorm-cli/authoring`.

| Component       | Description             | Props                                                                                        |
| :-------------- | :---------------------- | :------------------------------------------------------------------------------------------- |
| `Scroll`        | Root presentation       | `children`                                                                                   |
| `Slides`        | Root presentation       | `children`                                                                                   |
| `Tiles`         | Root presentation       | `children`, `columns` (1-12)                                                                 |
| `Page`          | Reference to a page     | `src` (root), `ref` (path)                                                                   |
| `Item`          | Reference to an item    | `src`                                                                                        |
| `Path`          | Ordered navigation path | `children`                                                                                   |
| `Image`         | Static image            | `src`, `alt`, `caption` (optional)                                                           |
| `Video`         | Video player            | `src`, `title` (optional), `poster` (optional), `captions` (optional)                        |
| `Questionnaire` | Assessment wrapper      | `children`, `contributesToScore` (bool), `expanded` (bool), `maxAttempts` (positive integer) |
| `Question`      | Single question         | `children`, `type` ('single-choice', 'multiple-choice', 'true-false')                        |
| `Prompt`        | Question text           | `children` (string)                                                                          |
| `Option`        | Answer choice           | `children` (string), `value`, `correct` (bool)                                               |

`Questionnaire.maxAttempts` defaults to `1` and counts total submissions,
including the first submission. It must be a positive integer.

## CLI Commands

### Build

Generate a SCORM package:

```bash
scorm-cli build ./my-content --output ./dist/course.zip --scorm 2004
```

- `--output`: Path to the output ZIP file.
- `--scorm`: Version (default: 1.2).

### Preview

Start a local preview server:

```bash
scorm-cli preview ./my-content --port 5173
```

- `--port`: Preview server port.
