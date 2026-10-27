// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContentRenderer } from '../../app/components/ContentRenderer'
import { readingAnchorAttributes, readingAnchorsForPage } from '../../app/lib/reading-anchors'
import type { ContentNode } from '../../app/types'

const nodes: ContentNode[] = [
  {
    type: 'heading',
    depth: 2,
    children: [{ type: 'text', value: 'Welcome' }]
  },
  {
    type: 'list',
    ordered: false,
    items: [
      {
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Inside' }] }]
      }
    ]
  },
  {
    type: 'code',
    language: 'ts',
    value: 'const value = 1'
  }
]

describe('ContentRenderer reading anchors', () => {
  it('renders the page-derived anchor attributes on eligible blocks', () => {
    const html = renderToStaticMarkup(
      <ContentRenderer nodes={nodes} readingAnchorPageId="page:a.mdx" />
    )
    const anchors = readingAnchorsForPage('page:a.mdx', nodes)
    const headingId = anchors.get('0')?.id
    const codeId = anchors.get('2')?.id
    const headingDomId = readingAnchorAttributes({ id: headingId!, pageId: 'page:a.mdx' }).id
    const codeDomId = readingAnchorAttributes({ id: codeId!, pageId: 'page:a.mdx' }).id

    expect(headingId).toBeDefined()
    expect(codeId).toBeDefined()
    expect(html).toContain(`id="${headingDomId}"`)
    expect(html).toContain(`data-reading-anchor="${headingId}"`)
    expect(html).toContain(`data-reading-anchor-page="page:a.mdx"`)
    expect(html).toContain(`id="${codeDomId}"`)
  })

  it('does not anchor list items or render anchors without a page owner', () => {
    const withPage = renderToStaticMarkup(
      <ContentRenderer nodes={nodes} readingAnchorPageId="page:a.mdx" />
    )
    expect(withPage.match(/data-reading-anchor=/g)).toHaveLength(2)

    const standalone = renderToStaticMarkup(<ContentRenderer nodes={nodes} />)
    expect(standalone).not.toContain('data-reading-anchor=')
  })

  it('renders anchors on eligible blocks nested inside a quote', () => {
    const nested: ContentNode[] = [
      {
        type: 'quote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'Nested' }] },
          { type: 'list', ordered: false, items: [] }
        ]
      }
    ]
    const pageId = 'page:quote.mdx'
    const html = renderToStaticMarkup(
      <ContentRenderer nodes={nested} readingAnchorPageId={pageId} />
    )
    const nestedId = readingAnchorsForPage(pageId, nested).get('0.0')?.id
    const nestedDomId = readingAnchorAttributes({ id: nestedId!, pageId }).id
    expect(nestedId).toBeDefined()
    expect(html).toContain(`id="${nestedDomId}"`)
    expect(html).toContain(`data-reading-anchor="${nestedId}"`)
    expect(html.match(/data-reading-anchor=/g)).toHaveLength(1)
  })

  it('keeps DOM IDs distinct across pages even when compact anchor hashes collide', () => {
    const nodes: ContentNode[] = [
      { type: 'paragraph', children: [{ type: 'text', value: 'Same content' }] }
    ]
    const pageA = 'page:a.mdx'
    const pageB = 'page:b.mdx'
    const forceCollision = () => 'abc12345'
    const html = renderToStaticMarkup(
      <>
        <ContentRenderer
          nodes={nodes}
          readingAnchorPageId={pageA}
          readingAnchors={readingAnchorsForPage(pageA, nodes, forceCollision)}
        />
        <ContentRenderer
          nodes={nodes}
          readingAnchorPageId={pageB}
          readingAnchors={readingAnchorsForPage(pageB, nodes, forceCollision)}
        />
      </>
    )
    const container = document.createElement('div')
    container.innerHTML = html
    const paragraphs = container.querySelectorAll('p')

    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]?.getAttribute('data-reading-anchor')).toBe('abc12345')
    expect(paragraphs[1]?.getAttribute('data-reading-anchor')).toBe('abc12345')
    expect(paragraphs[0]?.getAttribute('data-reading-anchor-page')).toBe(pageA)
    expect(paragraphs[1]?.getAttribute('data-reading-anchor-page')).toBe(pageB)
    expect(paragraphs[0]?.id).not.toBe(paragraphs[1]?.id)
  })
})
