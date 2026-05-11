import { CardNode } from "../types/ast";
import { getAttribute } from "./utils";

export function parseCard(node: any): CardNode {
  return {
    type: "card",
    href: getAttribute(node, "href") ?? "",
  };
}
