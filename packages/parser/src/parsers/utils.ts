import { toString } from "mdast-util-to-string";

export function getText(node: any): string {
  return toString(node);
}

export function hasAttribute(node: any, name: string): boolean {
  return node.attributes?.some((attr: any) => attr.name === name) ?? false;
}

export function getAttribute(node: any, name: string) {
  return node.attributes?.find((attr: any) => attr.name === name)?.value;
}

export function flattenChildren(children: any[]) {
  return children.flatMap((child) => {
    if (child.type === "paragraph") {
      return child.children;
    }

    return child;
  });
}

export function isMdxNode(node: any, name?: string): boolean {
  const isMdx =
    node?.type === "mdxJsxFlowElement" || node?.type === "mdxJsxTextElement";

  if (!name) {
    return isMdx;
  }

  return isMdx && node.name === name;
}
