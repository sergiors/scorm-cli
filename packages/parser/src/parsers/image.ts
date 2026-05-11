import { getAttribute } from "./utils";

export function parseImage(node: any) {
  return {
    type: "image",
    src: getAttribute(node, "src") ?? "",
    alt: getAttribute(node, "alt") ?? "",
  };
}
