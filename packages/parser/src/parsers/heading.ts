import { toString } from "mdast-util-to-string";
import { HeadingNode } from "../types/ast";

export function parseHeading(node: any): HeadingNode {
  return {
    type: "heading",
    depth: node.depth,
    text: toString(node),
  };
}
