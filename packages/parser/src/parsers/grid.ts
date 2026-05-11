import { flattenChildren, getAttribute, isMdxNode } from "./utils";

import { parseCard } from "./card";

export function parseGrid(node: any) {
  const children = flattenChildren(node.children);

  return {
    type: "grid",
    columns: Number(getAttribute(node, "columns") ?? 3),
    items: children.filter((child) => isMdxNode(child, "Card")).map(parseCard),
  };
}
