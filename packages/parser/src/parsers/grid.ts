import { GridNode } from "../types/ast";
import { parseCard } from "./card";
import { flattenChildren, getAttribute, isMdxNode } from "./utils";

export function parseGrid(node: any): GridNode {
  const children = flattenChildren(node.children);

  return {
    type: "grid",
    columns: Number(getAttribute(node, "columns") ?? 3),
    items: children.filter((child) => isMdxNode(child, "Card")).map(parseCard),
  };
}
