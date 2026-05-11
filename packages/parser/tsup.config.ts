import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  dts: {
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  splitting: false,
  outDir: "dist",
});
