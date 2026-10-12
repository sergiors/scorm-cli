/**
 * Pure HTML string transforms shared by the build and dev pipelines.
 *
 * These functions are the functional core of the document plumbing: they turn
 * an authored package's metadata into the served `index.html` and neutralise
 * author/script content that would otherwise break the document. They touch no
 * filesystem, Vite or browser state, so they are unit-tested directly instead of
 * only through a full Vite run.
 */

/** Escapes text for use in HTML text and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The document's declared language: the authored tag verbatim when present,
 * else `en`. Only surrounding whitespace is trimmed, so a declared language is
 * never rewritten to a canonical form and stays independent from the UI locale
 * the generated player renders in.
 */
export function declaredDocumentLanguage(lang: string | undefined): string {
  const declared = lang?.trim()
  return declared ? declared : 'en'
}

/**
 * Whether the player ships a UI dictionary for the base language of an authored
 * tag. This is a local authoring check only: it decides whether to warn that the
 * chrome will render in English and never alters the declared document language.
 */
export function hasPlayerDictionary(language: string): boolean {
  const base = language.toLowerCase().split('-')[0]
  return base === 'en' || base === 'pt'
}

/**
 * The opening `<html ...>` start tag. Quoted attribute values are matched whole
 * so a `>` inside a value cannot end the tag early, mirroring how the browser
 * parses the tag.
 */
const HTML_START_TAG = /<html\b(?:"[^"]*"|'[^']*'|[^>"'])*>/i

/**
 * A single attribute in a start tag: its leading whitespace, name, and an
 * optional `=`-separated value that is double-quoted, single-quoted or
 * unquoted. Quoted values are matched as one token, so text inside them — for
 * instance a `lang=` sequence in the value of another attribute — is never
 * mistaken for an attribute of its own.
 */
const HTML_ATTRIBUTE = /(\s+)([^\s"'>/=]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g

/**
 * Rewrites the document's `lang` attribute to `language`, adding it when the
 * template has none. The declared language is preserved even when it is not a
 * supported UI locale, so the browser and assistive tech still see it.
 *
 * Only a real `lang` attribute is touched: attributes are parsed one at a time
 * with quoted values treated as opaque, so a `lang=` sequence inside the value
 * of an unrelated attribute (e.g. `<html title="see lang=x">`) is left intact.
 * Look-alike names such as `data-lang` and `xml:lang` are not rewritten either.
 */
export function setDocumentLanguage(html: string, language: string): string {
  const escaped = escapeHtml(language)
  return html.replace(HTML_START_TAG, (tag) => {
    let replaced = false
    const rewritten = tag.replace(HTML_ATTRIBUTE, (attribute, lead: string, name: string) => {
      if (name.toLowerCase() !== 'lang') {
        return attribute
      }
      replaced = true
      return `${lead}lang="${escaped}"`
    })

    if (replaced) {
      return rewritten
    }
    // The replacement uses a function so a `$` in the escaped language is never
    // interpreted as a `String.replace` substitution pattern (`escapeHtml` keeps
    // `$`, so e.g. `$&` would otherwise expand to the matched `<html`).
    return tag.replace(/^<html/i, () => `<html lang="${escaped}"`)
  })
}

/**
 * Replaces the document's `<title>` with `title`, escaping it first. The
 * replacement uses a function so a `$` in the title is never interpreted as a
 * `String.replace` substitution pattern.
 */
export function setDocumentTitle(html: string, title: string): string {
  const escaped = escapeHtml(title)
  return html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escaped}</title>`)
}

/**
 * Neutralises a `</script>` sequence in an inline script body so it cannot
 * close the tag early and break the surrounding document.
 */
export function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}
