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

| Component       | Description                           | Props                                                                                                                                                                          |
| :-------------- | :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Scroll`        | Root presentation                     | `children`                                                                                                                                                                     |
| `Slides`        | Root presentation                     | `children`                                                                                                                                                                     |
| `Tiles`         | Root presentation                     | `children`, `columns` (1-12)                                                                                                                                                   |
| `Accordion`     | Expandable content                    | `children`, `multiple` (bool), `collapsible` (bool)                                                                                                                            |
| `Callout`       | Presentation-only highlighted content | `children`, `variant` (`note`, `info`, `tip`, `warning`, `danger`; defaults to `note`), `title` (optional string)                                                              |
| `Page`          | Reference to a page                   | `src` (root), `ref` (path)                                                                                                                                                     |
| `Item`          | Tile reference or accordion section   | `src` (Tiles), `defaultOpen` (Accordion)                                                                                                                                       |
| `Title`         | Accordion section title               | inline Markdown children                                                                                                                                                       |
| `Content`       | Accordion section body                | Markdown and supported flow content                                                                                                                                            |
| `Path`          | Ordered navigation path               | `children`                                                                                                                                                                     |
| `Image`         | Static image                          | `src`, `alt`, `caption` (optional)                                                                                                                                             |
| `Video`         | Video player                          | `src` (YouTube/Vimeo single-video URL), `title` (optional), `poster` (preview until ready), `duration` (optional seconds), `minWatchTime` (optional seconds)                   |
| `Questionnaire` | Assessment wrapper                    | `children`, `contributesToScore` (bool), `expanded` (bool), `maxAttempts` (-1 or positive integer), `revealCorrectAnswers` (bool, optional), `shuffleOptions` (bool, optional) |
| `Question`      | Single question                       | `children`, `type` ('single-choice', 'multiple-choice', 'true-false')                                                                                                          |
| `Prompt`        | Question text                         | `children` (string)                                                                                                                                                            |
| `Option`        | Answer choice                         | `children` (string), `value`, `correct` (bool)                                                                                                                                 |

`<Video src>` supports only individual YouTube and Vimeo videos, using absolute
HTTP(S) or safe protocol-relative URLs. YouTube supports `youtu.be/<11-character
ID>`, `watch?v=<11-character ID>`, and `/embed/`, `/shorts/`, or `/live/` routes;
playlist and user routes are not supported. Vimeo supports
`vimeo.com/<numeric ID>` and `player.vimeo.com/video/<numeric ID>`, including
share query strings and fragments. Local paths, relative URLs, and direct media
URLs (such as MP4 or HLS streams) are not supported. The provider is inferred
from the URL, so no provider prop is needed.
The optional `poster` image is shown in the reserved video frame until the hosted
player is ready.

`Questionnaire.maxAttempts` defaults to `1` and counts total submissions,
including the first submission. Use `-1` for unlimited attempts; otherwise it
must be a positive safe integer.

`Questionnaire.revealCorrectAnswers` defaults to `true` and controls only
per-option visual feedback after submission, not the overall summary.

`Questionnaire.shuffleOptions` defaults to `false` and changes only answer-option
presentation order—not question order, answer identity, or scoring.

An Accordion defaults to single-open and non-collapsible behavior: at most one
section is open, and one section always remains open. Set `multiple` to allow
several open sections, or `collapsible` to allow all sections to be closed; do
not set both to `true`. An Item's `defaultOpen` defaults to `false`, and a
single-open Accordion permits at most one `defaultOpen` item.

Use `<Callout>` to highlight ordinary Markdown and supported flow content.
Its `variant` defaults to `note`; supported variants are `note`, `info`, `tip`,
`warning`, and `danger`. The `title` is optional.

```mdx
<Callout variant="warning" title="Before you continue">
  Save your work before moving to the next section.
</Callout>

<Callout variant="tip">**Tip:** You can also use a callout without a title.</Callout>
```

```mdx
<Accordion multiple={false} collapsible>
  <Item defaultOpen>
    <Title>Getting started</Title>
    <Content>Read the **introduction** first.</Content>
  </Item>
  <Item>
    <Title>More details</Title>
    <Content>Continue with the next section.</Content>
  </Item>
</Accordion>
```

### Required video viewing

`<Video>` accepts two optional duration props. Values can be numeric seconds or
compact strings with `h`, `m`, and `s` units, such as `"30s"`, `"2m"`,
`"1m30s"`, and `"1h20m30s"`:

- `duration`: the expected length of the video. When present, it must be a
  positive number and `minWatchTime` must not exceed it.
- `minWatchTime`: the minimum amount of continuous playback a learner must
  complete. It must be positive, except `"0m0s"` is accepted as no watch
  requirement. A video without `minWatchTime` has no viewing requirement and
  behaves exactly as before.

```mdx
<Video src="https://vimeo.com/90509568" title="Lesson overview" duration={420} minWatchTime={300} />

<Video src="https://www.youtube.com/watch?v=M7lc1UVf-VE" title="Introduction" minWatchTime="3m" />
```

A required video gates its page in **Scroll** and **Slides**: the page completes
only after its end/display rule, every questionnaire, and every required video
are all satisfied. This also gates progress to the next page and package
completion. Tiles items are unchanged and still complete when opened.

Only normal, continuous playback counts toward the requirement. Pausing,
buffering, and seeking do not add verified time. Seeking backward is always
allowed. A forward seek beyond the learner's verified position is blocked and
the player is returned to that position; on YouTube, where seeks are not
reported directly, a progress discontinuity is detected the same way. Once the
minimum is met, seeking is unrestricted. Watching to the natural end of a
shorter media also completes the requirement.

Verified progress is stored per video and restored with the rest of the learner
state, so a resumed session continues from the saved verified point. The video
still never autoplays: a resume leaves it paused. Required videos show a
compact, localized progress indicator with accessible progress-bar semantics.

Video playback itself does not contribute to the package progress percentage;
it only gates page completion when `minWatchTime` is authored.

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
