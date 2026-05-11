import { toString } from "mdast-util-to-string";

export function parseList(node: any) {
  return {
    type: "list",
    items: node.children?.map((item: any) => toString(item)) ?? [],
  };
}
