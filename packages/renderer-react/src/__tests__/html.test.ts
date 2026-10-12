import { describe, expect, it } from 'vitest'
import {
  declaredDocumentLanguage,
  escapeHtml,
  escapeInlineScript,
  hasPlayerDictionary,
  setDocumentLanguage,
  setDocumentTitle
} from '../html'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Lessons 101 — Intro')).toBe('Lessons 101 — Intro')
  })
})

describe('declaredDocumentLanguage', () => {
  it('defaults to en when absent or blank', () => {
    expect(declaredDocumentLanguage(undefined)).toBe('en')
    expect(declaredDocumentLanguage('')).toBe('en')
    expect(declaredDocumentLanguage('   ')).toBe('en')
  })

  it('trims but never canonicalises the declared tag', () => {
    expect(declaredDocumentLanguage('  pt-BR  ')).toBe('pt-BR')
    expect(declaredDocumentLanguage('de-DE')).toBe('de-DE')
  })
})

describe('hasPlayerDictionary', () => {
  it('is true for the supported base languages and their variants', () => {
    expect(hasPlayerDictionary('en')).toBe(true)
    expect(hasPlayerDictionary('pt-BR')).toBe(true)
    expect(hasPlayerDictionary('PT')).toBe(true)
  })

  it('is false for unsupported languages', () => {
    expect(hasPlayerDictionary('de-DE')).toBe(false)
    expect(hasPlayerDictionary('es')).toBe(false)
  })
})

describe('setDocumentLanguage', () => {
  it('replaces an existing lang attribute', () => {
    expect(setDocumentLanguage('<html lang="en">', 'pt-BR')).toBe('<html lang="pt-BR">')
  })

  it('adds a lang attribute when the template has none', () => {
    expect(setDocumentLanguage('<html>', 'fr')).toBe('<html lang="fr">')
    expect(setDocumentLanguage('<html class="x">', 'fr')).toBe('<html lang="fr" class="x">')
  })

  it('keeps an unsupported declared language verbatim', () => {
    expect(setDocumentLanguage('<html lang="en">', 'de-DE')).toBe('<html lang="de-DE">')
  })

  it('does not rewrite look-alike attributes such as data-lang or xml:lang', () => {
    // `data-lang` is not a `lang` attribute, so the real attribute is added.
    expect(setDocumentLanguage('<html data-lang="en">', 'pt')).toBe(
      '<html lang="pt" data-lang="en">'
    )
    // Only the real `lang` is rewritten; `xml:lang` is left as authored.
    expect(setDocumentLanguage('<html xml:lang="en" lang="en">', 'pt')).toBe(
      '<html xml:lang="en" lang="pt">'
    )
  })

  it('escapes the language value', () => {
    expect(setDocumentLanguage('<html>', 'a"b')).toBe('<html lang="a&quot;b">')
  })
})

describe('setDocumentTitle', () => {
  it('replaces the title text', () => {
    expect(setDocumentTitle('<title>Old</title>', 'New')).toBe('<title>New</title>')
  })

  it('escapes the title', () => {
    expect(setDocumentTitle('<title>Old</title>', 'A & <b>')).toBe(
      '<title>A &amp; &lt;b&gt;</title>'
    )
  })

  it('treats a dollar sign in the title literally', () => {
    // A string replacement would interpret `$&`; the function form must not.
    expect(setDocumentTitle('<title>Old</title>', 'Cost $& more')).toBe(
      '<title>Cost $&amp; more</title>'
    )
  })
})

describe('escapeInlineScript', () => {
  it('neutralises a script-closing sequence in an inline body', () => {
    expect(escapeInlineScript('alert("</script>")')).toBe('alert("<\\/script>")')
  })

  it('is case-insensitive and handles every occurrence', () => {
    // The match is case-insensitive; the replacement is always the neutralised
    // lowercase sequence, which is all that matters for not closing the tag.
    expect(escapeInlineScript('a</SCRIPT>b</script>c')).toBe('a<\\/script>b<\\/script>c')
  })

  it('leaves ordinary script bodies untouched', () => {
    expect(escapeInlineScript('window.x = 1 < 2;')).toBe('window.x = 1 < 2;')
  })
})
