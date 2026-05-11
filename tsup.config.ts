import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/parser/src/index.ts"],
  format: ["esm"],
  clean: true,
  dts: true,
  splitting: false,
});
