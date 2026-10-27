# scorm-cli

Build SCORM 1.2 or SCORM 2004 packages from authored MDX content.

## Quick Start

1. **Install**: `npm install -g scorm-cli`
2. **Create a project** with an `index.mdx` file.
3. **Build**: `scorm-cli build ./my-content`
4. **Preview**: `scorm-cli preview ./my-content`

## Features

- **MDX-based Authoring**: Write course content using Markdown and specialized UI components.
- **Presentations**: Choose between `Scroll` (continuous), `Slides` (paginated), or `Tiles` (grid).
- **Interactive Assessments**: Create questionnaires with various question types.
- **SCORM Support**: Generate SCORM 1.2 or SCORM 2004 compliant packages.
- **Local Preview**: Develop and validate your content with a live-reloading preview server and a mock LMS API.

## Documentation

For a detailed guide on authoring, component configuration, and CLI options, see [docs/how-to-use.md](docs/how-to-use.md).

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE.md) for details.
