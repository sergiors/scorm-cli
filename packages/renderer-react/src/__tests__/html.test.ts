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

  it('ignores a lang look-alike inside a double-quoted attribute value', () => {
    // The `lang=` sits inside the `title` value, so no real `lang` exists and
    // the attribute is added without corrupting the quoted value.
    expect(setDocumentLanguage('<html title="see lang=x">', 'pt')).toBe(
      '<html lang="pt" title="see lang=x">'
    )
    // A genuine `lang` after the quoted value is still rewritten, and the
    // embedded look-alike is preserved verbatim.
    expect(setDocumentLanguage('<html title="see lang=x" lang="en">', 'pt')).toBe(
      '<html title="see lang=x" lang="pt">'
    )
  })

  it('ignores a lang look-alike inside a single-quoted attribute value', () => {
    expect(setDocumentLanguage(`<html title='see lang=x'>`, 'pt')).toBe(
      `<html lang="pt" title='see lang=x'>`
    )
    expect(setDocumentLanguage(`<html title='see lang=x' lang="en">`, 'pt')).toBe(
      `<html title='see lang=x' lang="pt">`
    )
  })

  it('ignores quoted lang attributes embedded in another attribute value', () => {
    // The single-quoted value contains a whole double-quoted `lang` attribute;
    // it must not be rewritten as if it were a real attribute.
    expect(setDocumentLanguage(`<html title='lang="en"'>`, 'pt')).toBe(
      `<html lang="pt" title='lang="en"'>`
    )
    expect(setDocumentLanguage(`<html title="lang='en'">`, 'pt')).toBe(
      `<html lang="pt" title="lang='en'">`
    )
  })

  it('does not mistake a > inside a quoted value for the end of the start tag', () => {
    // The `>` sits inside the `title` value, so it cannot end `<html ...>`; the
    // real `lang` after it is still rewritten and the value kept verbatim.
    expect(setDocumentLanguage('<html title="a>b" lang="en">', 'pt')).toBe(
      '<html title="a>b" lang="pt">'
    )
    expect(setDocumentLanguage(`<html title='a>b' lang="en">`, 'pt')).toBe(
      `<html title='a>b' lang="pt">`
    )
  })

  it('escapes the language value', () => {
    expect(setDocumentLanguage('<html>', 'a"b')).toBe('<html lang="a&quot;b">')
  })

  it('treats dollar signs in the added language value literally', () => {
    // The escaped value keeps `$`, so the add-attribute fallback must use a
    // function replacement: a string replacement would interpret the special
    // patterns `$&` (the matched `<html`), `$$` and the backtick form that
    // inserts the preceding text, even though the pattern has no capture
    // groups. The `$1` case is asserted only to document that a group reference
    // with no matching group is left literal.
    expect(setDocumentLanguage('<html>', '$&')).toBe('<html lang="$&amp;">')
    expect(setDocumentLanguage('<html>', '$1')).toBe('<html lang="$1">')
    expect(setDocumentLanguage('<html>', '$$')).toBe('<html lang="$$">')
    expect(setDocumentLanguage('<html>', '$`')).toBe('<html lang="$`">')
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
