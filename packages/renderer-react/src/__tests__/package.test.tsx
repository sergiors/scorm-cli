import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PackageApp } from '../../app/App'
import { PackageView } from '../../app/components/PackageView'
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
      <PackageView
        contentPackage={contentPackage}
        contentProvider={inlineContentProvider(contentPackage)}
      />
    </PlayerI18nProvider>
  )
}

describe('PackageView scroll presentation', () => {
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

  it('renders the current page as a min-viewport, natural-height scene without paging controls', () => {
    const html = renderView(scrollPackage)
    // Pages reserve at least one small viewport and grow naturally beyond it —
    // never a dynamic viewport height and never vertically centered — and no
    // adjacent page peeks in.
    expect(html).not.toContain('dvh')
    const sceneTag = html.match(/<div data-scene-index="0"[^>]*>/)?.[0] ?? ''
    const sceneClasses = sceneTag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    expect(sceneClasses).toContain('min-h-svh')
    expect(sceneClasses).not.toContain('h-svh')
    expect(sceneClasses).not.toContain('max-h-svh')
    expect(sceneClasses).not.toContain('justify-center')
    expect(sceneTag).toContain('max-w-3xl')
    // The wrapper keeps its responsive horizontal content padding but carries no
    // vertical padding, margin, gap or scroll class — responsive or not — so
    // consecutive page wrappers meet directly with no artificial gap between them.
    expect(sceneClasses).toContain('px-4')
    const wrapperUtilities = sceneClasses.map((name) => name.slice(name.lastIndexOf(':') + 1))
    for (const spacing of ['py-', 'pt-', 'pb-', 'my-', 'mt-', 'mb-', 'gap-', 'scroll-']) {
      expect(wrapperUtilities.some((name) => name.startsWith(spacing))).toBe(false)
    }
    // The intentional, responsive vertical padding lives inside the page, on its
    // content, so a page still reads with breathing room from its top and bottom
    // edges even though the wrapper itself is spacing-free.
    const contentTag = html.match(/<div data-scroll-page-content[^>]*>/)?.[0] ?? ''
    expect(contentTag).not.toBe('')
    expect(contentTag).toContain('py-8')
    expect(contentTag).toContain('sm:py-12')
    // The current page is marked semantically; the package adds no animation,
    // transition or scroll snapping of its own.
    expect(sceneTag).toContain('data-active="true"')
    expect(html).not.toContain('transition-opacity')
    expect(html).not.toContain('duration-200')
    expect(html).not.toContain('motion-reduce:transition-none')
    expect(html).not.toContain('snap-proximity')
    expect(html).not.toContain('snap-start')
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

describe('PackageView tiles presentation', () => {
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

describe('PackageView shared', () => {
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
