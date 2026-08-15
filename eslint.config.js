import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // React-Compiler diagnostic rules. This project has no React Compiler in
      // its build pipeline, and its established (documented-in-CLAUDE.md) idioms
      // — render-time mirror refs like `viewRef.current = view` and small
      // reset-state effects — are deliberate. These rules only began firing when
      // useVirtualizer moved out of App.jsx (the analyzer previously skipped the
      // whole component as compiler-incompatible); disabling them preserves the
      // codebase's existing conventions rather than rewriting load-bearing code.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: ['electron/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
