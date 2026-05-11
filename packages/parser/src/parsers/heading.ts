import { toString } from "mdast-util-to-string";

export function parseHeading(node: any) {
  return {
    type: "heading",
    depth: node.depth,
    text: toString(node),
  };
}
