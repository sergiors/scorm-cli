# SCORM CLI

CLI for creating SCORM content using MDX.

## Monorepo Structure

```
scorm-cli/
├── packages/
│   ├── parser/      # MDX to AST parser
│   └── react/       # React components for rendering
└── examples/        # Course examples
```

## Packages

### @scorm-cli/parser

Parser that transforms `.mdx` files into a SCORM data structure.

**Usage:**
```ts
import { parseFile } from "@scorm-cli/parser";

const result = await parseFile("./course/index.mdx");
```

### @scorm-cli/react

React components for rendering SCORM content.

**Components:**
- `<Grid>` - Grid layout
- `<Card>` - Navigable cards
- `<Image>` - Images

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Dev mode (runs all packages)
pnpm run dev
```

## MDX Components

In your MDX files, use the components:

```mdx
import { Grid, Card, Image } from "@scorm-cli/components";

<Grid>
  <Card href="./lesson1.mdx" />
  <Card href="./lesson2.mdx" />
</Grid>

<Image src="./assets/diagram.png" alt="Diagram" />
```
