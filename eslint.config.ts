import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...svelte.configs["flat/recommended"],
  prettier,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
      },
    },
    rules: {
      // no-undef/no-unused-vars mit TS-Syntax übernimmt svelte-check (tsc,
      // noUnusedLocals + lib-DOM) — die Core-Regeln verstehen TS nicht.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
);
