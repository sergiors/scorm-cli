import { getAttribute } from "./utils";

export function parseCard(node: any) {
  return {
    type: "card",
    href: getAttribute(node, "href") ?? "",
  };
}
