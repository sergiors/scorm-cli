import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { AstNode, fail } from './shared';

const processor = unified().use(remarkParse).use(remarkMdx);
export const flowComponents = new Set(['Video', 'Question', 'Questionnaire', 'Path']);

/** The only module MDX content may import components from. */
const authoringSource = 'scorm-cli/authoring';

/**
 * Canonical component names recognized by the parser, in the same order as the
 * `scorm-cli/authoring` marker exports. Exported so tooling and tests can
 * assert the authoring vocabulary stays aligned with the parser contract.
 */
export const authoringComponentNames = [
  'Scroll',
  'Grid',
  'Page',
  'Item',
  'Path',
  'Image',
  'Video',
  'Questionnaire',
  'Question',
  'Prompt',
  'Option',
] as const;

const authoringComponents = new Set<string>(authoringComponentNames);

/**
 * Canonical component name for every parsed JSX node, resolved from
 * `scorm-cli/authoring` imports. Keyed by node identity so the same traversal
 * helpers can read it without threading resolver state through every call.
 */
const resolvedComponentNames = new WeakMap<AstNode, string>();

/**
 * Sentinel canonical name for JSX bound by an import from a module other than
 * `scorm-cli/authoring`. It matches no canonical component, so shadowed names
 * are reported as unknown instead of falling back to the legacy raw-name
 * vocabulary.
 */
const shadowedComponentName = '\u0000shadowed';

/** The canonical name a JSX node refers to after resolving authoring imports. */
export function componentName(node: AstNode): string {
  return resolvedComponentNames.get(node) ?? node.name ?? '';
}

interface ImportBindings {
  /** Local names bound by named authoring imports, mapped to their marker. */
  aliases: Map<string, string>;
  /** Local names bound by `import * as` authoring imports. */
  namespaces: Set<string>;
  /**
   * Local names bound by imports from modules other than `scorm-cli/authoring`.
   * They can never name an authoring component, so JSX using one must be
   * treated as unknown instead of falling back to the canonical vocabulary.
   */
  shadowed: Set<string>;
}

/**
 * Collects import bindings from every ESM import in a document. Imports from
 * `scorm-cli/authoring` name canonical components (directly or through aliases
 * and namespace members); authoring bindings win over any other import. Every
 * other import still binds its local name, so it shadows the legacy raw-name
 * vocabulary even though it can never resolve to a canonical component.
 */
function collectImportBindings(nodes: AstNode[], file: string): ImportBindings {
  const aliases = new Map<string, string>();
  const namespaces = new Set<string>();
  const shadowed = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'mdxjsEsm') continue;
    for (const statement of node.data?.estree?.body ?? []) {
      if (statement.type !== 'ImportDeclaration') continue;
      const fromAuthoring = statement.source?.value === authoringSource;
      for (const specifier of statement.specifiers ?? []) {
        const local = typeof specifier.local?.name === 'string' ? specifier.local.name : undefined;
        if (!local) continue;
        if (!fromAuthoring) {
          shadowed.add(local);
          continue;
        }
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaces.add(local);
          continue;
        }
        if (specifier.type === 'ImportDefaultSpecifier')
          fail(
            file,
            `"${authoringSource}" provides named exports only; import "Page", "Scroll", and friends by name`,
            node,
          );
        if (specifier.type !== 'ImportSpecifier') continue;
        const imported =
          typeof specifier.imported?.name === 'string' ? specifier.imported.name : undefined;
        if (!imported) continue;
        if (!authoringComponents.has(imported))
          fail(
            file,
            `"${imported}" is not an authoring component exported by "${authoringSource}"`,
            node,
          );
        const existing = aliases.get(local);
        if (existing && existing !== imported)
          fail(
            file,
            `import binding "${local}" is declared more than once for different authoring components`,
            node,
          );
        aliases.set(local, imported);
      }
    }
  }
  return { aliases, namespaces, shadowed };
}

/** Whether an ESM node contains only import declarations and can be ignored. */
function isImportOnlyEsm(node: AstNode): boolean {
  const body = node.data?.estree?.body;
  return (
    Array.isArray(body) &&
    body.length > 0 &&
    body.every((statement) => statement.type === 'ImportDeclaration')
  );
}

/** Resolves a JSX name to its canonical authoring component name. */
function resolveComponentName(
  name: string,
  bindings: ImportBindings,
  file: string,
  node: AstNode,
): string {
  const dot = name.indexOf('.');
  if (dot > 0) {
    const namespace = name.slice(0, dot);
    const member = name.slice(dot + 1);
    if (bindings.namespaces.has(namespace)) {
      if (!authoringComponents.has(member))
        fail(
          file,
          `"${member}" is not an authoring component exported by "${authoringSource}"`,
          node,
        );
      return member;
    }
    if (bindings.shadowed.has(namespace)) return shadowedComponentName;
    return name;
  }
  const alias = bindings.aliases.get(name);
  if (alias) return alias;
  if (bindings.shadowed.has(name)) return shadowedComponentName;
  return name;
}

/** Records the canonical name of every JSX node in a parsed tree. */
function resolveComponentNames(nodes: AstNode[], bindings: ImportBindings, file: string): void {
  for (const node of nodes) {
    if (
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      typeof node.name === 'string'
    ) {
      resolvedComponentNames.set(node, resolveComponentName(node.name, bindings, file, node));
    }
    if (node.children) resolveComponentNames(node.children, bindings, file);
  }
}

export function parseMdx(source: string, file: string): { children: AstNode[] } {
  let tree: { children: AstNode[] };
  try {
    tree = processor.parse(source) as { children: AstNode[] };
  } catch (error) {
    const detail = error as {
      message?: string;
      line?: number;
      column?: number;
    };
    const position = detail.line
      ? `:${detail.line}${detail.column ? `:${detail.column}` : ''}`
      : '';
    throw new Error(`${file}${position}: ${detail.message ?? String(error)}`);
  }
  const definitions = new Map(
    tree.children
      .filter(
        (node): node is AstNode & { identifier: string; url: string } =>
          node.type === 'definition' &&
          typeof node.identifier === 'string' &&
          typeof node.url === 'string',
      )
      .map((node) => [node.identifier.toLowerCase(), node.url]),
  );
  const resolveReferences = (nodes: AstNode[]) => {
    for (const node of nodes) {
      if (node.type === 'linkReference' || node.type === 'imageReference') {
        const url = definitions.get(node.identifier?.toLowerCase() ?? '');
        if (!url) fail(file, `undefined Markdown reference "${node.identifier ?? ''}"`, node);
        node.type = node.type === 'linkReference' ? 'link' : 'image';
        node.url = url;
      }
      if (node.children) resolveReferences(node.children);
    }
  };
  resolveReferences(tree.children);
  const bindings = collectImportBindings(tree.children, file);
  resolveComponentNames(tree.children, bindings, file);
  // Import declarations are inert metadata: `scorm-cli/authoring` imports drive
  // canonical component resolution while every other import shadows its local
  // bindings; imports are removed before content validation. Non-import ESM
  // (for example `export` statements) is left in place and rejected below.
  tree.children = tree.children.filter(
    (node) => node.type !== 'definition' && !(node.type === 'mdxjsEsm' && isImportOnlyEsm(node)),
  );
  return tree;
}
