// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContentRenderer } from '../../app/components/ContentRenderer'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type { ContentNode, ContentPackage, InlineNode } from '../../app/types'

const text = (value: string): InlineNode => ({ type: 'text', value })

const callout = (
  variant: 'note' | 'info' | 'tip' | 'warning' | 'danger',
  title: string | undefined,
  children: ContentNode[]
): ContentNode => ({
  type: 'callout',
  variant,
  ...(title === undefined ? {} : { title }),
  children
})

function contentPackage(nodes: ContentNode[]): ContentPackage {
  return {
    metadata: { title: 'Callout test' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page:callout-test.mdx',
          source: 'callout-test.mdx',
          metadata: { title: 'Callout test' },
          content: nodes
        }
      ]
    }
  }
}

/** Renders the player contexts around a page whose authored content is `nodes`. */
function render(nodes: ContentNode[]): string {
  window.scormBridge = { restoreState: () => ({ pages: {} }) }
  return renderToStaticMarkup(
    <PlayerI18nProvider>
      <PlayerProvider contentPackage={contentPackage(nodes)}>
        <PageProvider pageId="page:callout-test.mdx">
          <ContentRenderer nodes={nodes} />
        </PageProvider>
      </PlayerProvider>
    </PlayerI18nProvider>
  )
}

/**
 * Unescapes the attribute-value entities `renderToStaticMarkup` emits, so class
 * assertions stay on real Tailwind source strings instead of escaped markup.
 */
function decodedAttribute(html: string, pattern: RegExp): string | undefined {
  const raw = html.match(pattern)?.[1]
  return raw
    ?.replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
}

describe('callout wrapper semantics', () => {
  it('renders a semantic note surface with the variant marker and one icon', () => {
    const html = render([
      callout('info', undefined, [{ type: 'paragraph', children: [text('Body text')] }])
    ])

    expect(html).toContain('role="note"')
    expect(html).toContain('data-slot="callout"')
    expect(html).toContain('data-variant="info"')
    // One decorative icon is rendered per callout; it carries no accessible
    // name so screen readers announce only the note body.
    expect((html.match(/<svg/g) ?? []).length).toBe(1)
    expect(html).toContain('aria-hidden="true"')
    // The icon inherits its color from the variant accent: the Alert
    // primitive colors its svg descendants from the wrapper's current color.
    expect(html).toContain('*:[svg]:text-current')
    // The body renders as ordinary flow content inside the Alert primitive's
    // description slot, whose margin collapsing keeps the callout padding as
    // the only outer spacing.
    const bodyWrapper = decodedAttribute(
      html,
      /<div data-slot="alert-description" class="([^"]*)"><p>Body text<\/p>/
    )
    expect(bodyWrapper, 'body margin collapse').toBeDefined()
    expect(bodyWrapper!).toContain('[&>*:first-child]:mt-0')
    expect(bodyWrapper!).toContain('[&>*:last-child]:mb-0')
    expect(html).toContain('<p>Body text</p>')
  })

  it('renders the optional title as a small heading and works without one', () => {
    const titled = render([
      callout('warning', 'Heads up', [{ type: 'paragraph', children: [text('Body')] }])
    ])
    expect(titled).toContain('Heads up')
    // The title lives in the Alert primitive's title slot as plain text.
    expect(titled).toContain('data-slot="alert-title"')
    expect(titled).toMatch(/<div data-slot="alert-title"[^>]*>Heads up<\/div>/)

    const untitled = render([
      callout('warning', undefined, [{ type: 'paragraph', children: [text('Body')] }])
    ])
    // Without a title the title row disappears entirely; the body stays in the
    // description slot.
    expect(untitled).not.toContain('data-slot="alert-title"')
    expect(untitled).toContain('data-slot="alert-description"')
    expect(untitled).toContain('<p>Body</p>')
  })

  it('keeps an empty title out of the markup', () => {
    const html = render([callout('note', '', [{ type: 'paragraph', children: [text('Body')] }])])
    expect(html).not.toContain('data-slot="alert-title"')
    expect(html).toContain('<p>Body</p>')
  })
})

describe('callout variant presentation', () => {
  // Per-variant contract: the lucide icon class on the decorative svg, and the
  // wrapper surface which now also carries the accent the icon inherits.
  const variants = [
    {
      variant: 'note',
      icon: 'lucide-sticky-note',
      surface: 'bg-muted/40',
      accent: 'text-muted-foreground'
    },
    { variant: 'info', icon: 'lucide-info', surface: 'border-sky-500/30', accent: 'text-sky-600' },
    {
      variant: 'tip',
      icon: 'lucide-lightbulb',
      surface: 'border-emerald-500/30',
      accent: 'text-emerald-600'
    },
    {
      variant: 'warning',
      icon: 'lucide-triangle-alert',
      surface: 'border-amber-500/30',
      accent: 'text-amber-600'
    },
    {
      variant: 'danger',
      icon: 'lucide-octagon-alert',
      surface: 'border-destructive/30',
      accent: 'text-destructive'
    }
  ] as const

  it('uses the dedicated icon and surface treatment for every variant', () => {
    for (const { variant, icon, surface, accent } of variants) {
      const html = render([
        callout(variant, undefined, [{ type: 'paragraph', children: [text('Body')] }])
      ])
      // The Alert primitive emits its own slot first; `role` and the variant
      // marker follow inside the same opening tag in primitive-prop order.
      const wrapper = html.match(/<div data-slot="callout"[^>]*>/)?.[0]
      expect(wrapper, `wrapper for ${variant}`).toBeDefined()
      expect(wrapper, `wrapper for ${variant}`).toContain(`data-variant="${variant}"`)
      expect(wrapper!, `surface for ${variant}`).toContain(surface)
      // The icon accent travels on the wrapper surface; the bare svg inherits
      // it through the primitive's descendant selectors instead of own classes.
      expect(wrapper!, `accent for ${variant}`).toContain(accent)
      const svg = html.match(/<svg[^>]*class="([^"]*)"/)?.[1]
      expect(svg, `icon for ${variant}`).toContain(`lucide ${icon}`)
    }
  })

  it('does not mix variant surfaces between adjacent callouts', () => {
    const html = render([
      callout('tip', undefined, [{ type: 'paragraph', children: [text('First')] }]),
      callout('danger', undefined, [{ type: 'paragraph', children: [text('Second')] }])
    ])
    expect((html.match(/data-slot="callout"/g) ?? []).length).toBe(2)
    expect(html).toContain('border-emerald-500/30')
    expect(html).toContain('border-destructive/30')
    expect((html.match(/lucide-lightbulb/g) ?? []).length).toBe(1)
    expect((html.match(/lucide-octagon-alert/g) ?? []).length).toBe(1)
  })
})

describe('callout body rendering', () => {
  it('renders nested inline Markdown in the body', () => {
    const html = render([
      {
        type: 'callout',
        variant: 'note',
        children: [
          {
            type: 'paragraph',
            children: [
              text('Read '),
              { type: 'strong', children: [text('the notes')] },
              { type: 'inlineCode', value: 'run()' },
              text(' and '),
              { type: 'emphasis', children: [text('carefully')] },
              { type: 'link', href: 'https://example.test/docs', children: [text('docs')] },
              text('.')
            ]
          }
        ]
      }
    ])
    expect(html).toContain('<strong')
    expect(html).toContain('<em class="italic">')
    expect(html).toContain('<code')
    expect(html).toContain('<a href="https://example.test/docs"')
  })

  it('renders nested heading, list, and code blocks in the body', () => {
    const html = render([
      {
        type: 'callout',
        variant: 'tip',
        children: [
          { type: 'heading', depth: 3, children: [text('Setup steps')] },
          {
            type: 'list',
            ordered: false,
            spread: false,
            items: [
              { children: [{ type: 'inlineContent', children: [text('one')] }] },
              { children: [{ type: 'inlineContent', children: [text('two')] }] }
            ]
          },
          { type: 'code', value: 'const x = 1 < 2;', language: 'ts' }
        ]
      }
    ])
    expect(html).toContain('<h3>')
    expect(html).toContain('<li>')
    expect(html).toContain('data-slot="code-block"')
    expect(html).toContain('const x = 1 &lt; 2;')
  })

  it('renders a nested callout with its own variant and icon', () => {
    const html = render([
      {
        type: 'callout',
        variant: 'warning',
        title: 'Outer title',
        children: [
          {
            type: 'callout',
            variant: 'danger',
            children: [{ type: 'paragraph', children: [text('Inner body')] }]
          }
        ]
      }
    ])
    expect((html.match(/data-slot="callout"/g) ?? []).length).toBe(2)
    expect(html).toContain('data-variant="warning"')
    expect(html).toContain('data-variant="danger"')
    expect((html.match(/lucide-octagon-alert/g) ?? []).length).toBe(1)
    expect(html).toContain('Inner body')
  })
})

describe('callout alongside existing content', () => {
  it('renders preexisting sibling content unchanged, in order', () => {
    const html = render([
      { type: 'paragraph', children: [text('Before the note')] },
      callout('info', 'Reminder', [{ type: 'paragraph', children: [text('Callout body')] }]),
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [{ children: [{ type: 'inlineContent', children: [text('list item')] }] }]
      }
    ])
    const before = html.indexOf('Before the note')
    const note = html.indexOf('data-variant="info"')
    const after = html.indexOf('<li>')
    expect(note).toBeGreaterThan(before)
    expect(after).toBeGreaterThan(note)
    expect(html).toContain('Callout body')
    expect(html).toContain('list item')
  })
})
