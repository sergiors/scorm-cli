import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PackageApp } from '../../app/App'
import { Presentation } from '../../app/components/Presentation'
import { PlayerProvider } from '../../app/lib/player-context'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type { ContentPackage } from '../../app/types'
import {
  headingDepths,
  inlineContentProvider,
  makeEmptyPackage,
  makeEmptyTilesPackage,
  scrollPackage,
  tilesPackage
} from './fixtures'

const headingScrollPackage: ContentPackage = {
  metadata: { title: 'Headings' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:headings.mdx',
        source: 'headings.mdx',
        metadata: { title: 'Headings' },
        content: headingDepths
      }
    ]
  }
}

function renderView(contentPackage: ContentPackage) {
  return renderToStaticMarkup(
    <PlayerI18nProvider lang={contentPackage.metadata.lang}>
      <PlayerProvider contentPackage={contentPackage}>
        <Presentation
          contentPackage={contentPackage}
          contentProvider={inlineContentProvider(contentPackage)}
        />
      </PlayerProvider>
    </PlayerI18nProvider>
  )
}

describe('Presentation scroll presentation', () => {
  it('renders only the first page', () => {
    const html = renderView(scrollPackage)
    // The scene is named after the page metadata; the visible body is authored.
    expect(html).toContain('aria-label="Introduction"')
    expect(html).toContain('Welcome')
    expect(html).not.toContain('Setting things up')
    expect(html).not.toContain('Setup instructions.')
  })

  it('does not render a package header, navigation shell or skip link', () => {
    const html = renderView(scrollPackage)
    expect(html).not.toContain('Rendering Fundamentals')
    expect(html).not.toContain('Package navigation')
    expect(html).not.toContain('Skip to content')
    expect(html).not.toContain('Item 1 of')
  })

  it('renders authored Markdown depths 1-6 as matching h1-h6', () => {
    const html = renderView(headingScrollPackage)
    for (let level = 1; level <= 6; level += 1) {
      expect(html).toContain(`<h${level}`)
      expect(html).toContain(`Level ${level}`)
    }
  })

  it('renders the current page as a natural-height scene without paging controls', () => {
    const html = renderView(scrollPackage)
    // Pages keep their natural content height — no viewport-based sizing, never
    // vertically centered — and no adjacent page peeks in.
    expect(html).not.toContain('dvh')
    const sceneTag = html.match(/<div data-scene-index="0"[^>]*>/)?.[0] ?? ''
    const sceneClasses = sceneTag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    expect(sceneClasses).not.toContain('min-h-svh')
    expect(sceneClasses).not.toContain('h-svh')
    expect(sceneClasses).not.toContain('max-h-svh')
    expect(sceneClasses).not.toContain('justify-center')
    // The width and horizontal padding live once on the shared column around the
    // whole list, never on an individual page slot.
    expect(sceneTag).not.toContain('max-w-3xl')
    expect(sceneClasses).not.toContain('px-4')
    // The page slot carries no padding, margin, gap or scroll class — any of
    // which would open an artificial space between consecutive pages.
    const wrapperUtilities = sceneClasses.map((name) => name.slice(name.lastIndexOf(':') + 1))
    for (const spacing of ['py-', 'pt-', 'pb-', 'my-', 'mt-', 'mb-', 'gap-', 'scroll-']) {
      expect(wrapperUtilities.some((name) => name.startsWith(spacing))).toBe(false)
    }
    // The page content carries no vertical padding of its own either, so
    // consecutive pages meet with only their natural typography spacing between
    // them and no artificial vertical space is introduced.
    const contentTag = html.match(/<div data-scroll-page-content[^>]*>/)?.[0] ?? ''
    expect(contentTag).not.toBe('')
    expect(contentTag).not.toMatch(/\b(py-|pt-|pb-)/)
    // The prose region wrapping the authored content adds no vertical padding of
    // its own either, so pages keep only their natural typography spacing and no
    // explicit gap opens between consecutive pages.
    const proseTag = html.match(/<section class="[^"]*prose[^"]*"/)?.[0] ?? ''
    expect(proseTag).not.toBe('')
    expect(proseTag).not.toMatch(/\b(py-|pt-|pb-)/)
    // A single shared column frames the whole list: one responsive max width and
    // horizontal padding, and no overflow, height or vertical padding that could
    // turn it into a second scroll container.
    const columnTag = html.match(/<div data-scroll-column[^>]*>/)?.[0] ?? ''
    expect(columnTag).not.toBe('')
    expect(columnTag).toContain('mx-auto')
    expect(columnTag).toContain('w-full')
    expect(columnTag).toContain('max-w-3xl')
    expect(columnTag).toContain('px-4')
    expect(columnTag).toContain('sm:px-6')
    const columnUtilities = (columnTag.match(/class="([^"]*)"/)?.[1] ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => name.slice(name.lastIndexOf(':') + 1))
    for (const forbidden of ['overflow-', 'h-', 'min-h-', 'max-h-', 'py-', 'pt-', 'pb-']) {
      expect(columnUtilities.some((name) => name.startsWith(forbidden))).toBe(false)
    }
    // The current page is marked semantically; the package's own chrome — the
    // scene, its content block, the prose wrapper and the shared column — adds
    // no animation, transition or scroll snapping of its own. Utilities inside
    // authored widgets (e.g. the code block's hover-revealed copy action) are
    // that widget's own styling, not the package's scene chrome.
    expect(sceneTag).toContain('data-active="true"')
    const packageChrome = [sceneTag, contentTag, proseTag, columnTag].join('')
    expect(packageChrome).not.toContain('transition-opacity')
    expect(packageChrome).not.toContain('duration-200')
    expect(packageChrome).not.toContain('motion-reduce:transition-none')
    expect(packageChrome).not.toContain('snap-proximity')
    expect(packageChrome).not.toContain('snap-start')
    // The package never exposes scroll paging controls; the questionnaire's
    // own wizard controls are unrelated and may be present.
    expect(html).not.toContain('Previous page')
    expect(html).not.toContain('Continue to next page')
  })

  it('shows an empty state when a scroll package has no pages', () => {
    const html = renderView(makeEmptyPackage())
    expect(html).toContain('does not contain any content')
  })
})

describe('Presentation tiles presentation', () => {
  it('renders tile cards using the authored titles', () => {
    const html = renderView(tilesPackage)
    expect(html).toContain('Functions')
    expect(html).toContain('Types')
    expect(html).toContain('Extra details')
  })

  it('does not render tile content inline', () => {
    const html = renderView(tilesPackage)
    expect(html).not.toContain('Function body.')
    expect(html).not.toContain('Modal body content.')
  })

  it('carries the authored column count into the responsive grid', () => {
    const html = renderView(tilesPackage)
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('--tiles-columns:2')
  })

  it('does not open a dialog until a card is selected', () => {
    const html = renderView(tilesPackage)
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('data-slot="dialog-content"')
  })

  it('renders locked tiles as disabled so they are behaviorally inaccessible', () => {
    const html = renderView(tilesPackage)
    expect(html).toContain('data-tile-status="locked"')
    expect(html).toContain('disabled')
  })

  it('shows an empty state when a tiles package has no tiles', () => {
    const html = renderView(makeEmptyTilesPackage())
    expect(html).toContain('does not contain any content')
  })
})

describe('Presentation shared', () => {
  it('does not render any progress or completion UI of its own', () => {
    const scrollHtml = renderView(scrollPackage)
    const tilesHtml = renderView(tilesPackage)
    for (const html of [scrollHtml, tilesHtml]) {
      // Every progressbar must be an authored questionnaire's own wizard
      // counter; the package adds no progress chrome of its own.
      const progressbars = html.match(/role="progressbar"/g) ?? []
      const questionnaireProgress = html.match(/data-slot="questionnaire-progress"/g) ?? []
      expect(progressbars).toHaveLength(questionnaireProgress.length)
      expect(html).not.toContain('items visited')
      expect(html).not.toContain('Package complete')
      expect(html).not.toContain('Completed')
    }
  })
})

describe('PackageApp', () => {
  it('renders the authored scroll view for the provided content package', () => {
    const html = renderToStaticMarkup(
      <PackageApp
        contentPackage={scrollPackage}
        contentProvider={inlineContentProvider(scrollPackage)}
      />
    )
    expect(html).toContain('Welcome')
  })

  it('renders the authored tiles view for the provided content package', () => {
    const html = renderToStaticMarkup(
      <PackageApp
        contentPackage={tilesPackage}
        contentProvider={inlineContentProvider(tilesPackage)}
      />
    )
    expect(html).toContain('Functions')
  })
})
