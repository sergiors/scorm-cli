import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['authoring/src/index.ts'],
  format: ['esm'],
  dts: {
    tsconfig: 'authoring/tsconfig.json',
    compilerOptions: {
      ignoreDeprecations: '6.0',
    },
  },
  clean: true,
  splitting: false,
  outDir: 'authoring/dist',
  shims: true,
});
