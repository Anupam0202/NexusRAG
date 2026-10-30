import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import a11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

// Maintained, explicit lint stack: no legacy fast-glob/micromatch/braces path.
export default defineConfig([
  // Wrangler emits bundled dependencies here after local Worker verification.
  // Lint maintained source (including worker.js), never generated runtime code.
  globalIgnores([".next/**", ".open-next/**", ".wrangler/**", "out/**", "build/**", "next-env.d.ts", "src/e2e/visual-regression.spec.ts-snapshots/**"]),
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { react: { version: "detect" } },
    plugins: { "react-hooks": hooks },
    rules: { ...hooks.configs.recommended.rules, "react-hooks/set-state-in-effect": "off" },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { react, "jsx-a11y": a11y },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...a11y.configs.recommended.rules,
      "react/prop-types": "off",
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["region"] }],
      "jsx-a11y/anchor-is-valid": ["error", { aspects: ["invalidHref", "preferButton"] }],
    },
  },
]);
