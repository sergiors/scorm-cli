import { ListNode } from "../types/ast";
import { getText } from "./utils";

export function parseList(node: any): ListNode {
  return {
    type: "list",
    items: node.children?.map((item: any) => getText(item)) ?? [],
  };
}
