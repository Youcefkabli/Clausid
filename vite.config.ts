import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
  lint: {
    options: { typeAware: true, typeCheck: false },
    ignorePatterns: ['apps/website/**', '**/*.d.ts', '**/dist/**'],
    plugins: ['typescript', 'oxc'],
    rules: { curly: ['error', 'all'] },
    overrides: [
      {
        files: ['**/*.ts', '**/*.tsx', '**/*.mts'],
        rules: {
          'typescript/no-explicit-any': 'error',
          'typescript/no-unsafe-assignment': 'error',
          'typescript/no-unsafe-argument': 'error',
          'typescript/no-unsafe-call': 'error',
          'typescript/no-unsafe-member-access': 'error',
          'typescript/no-unsafe-return': 'error',
          'typescript/no-floating-promises': 'error',
          'typescript/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
          'typescript/switch-exhaustiveness-check': 'error',
          'typescript/no-non-null-assertion': 'error',
          'typescript/prefer-readonly': 'error',
          'typescript/ban-ts-comment': 'error',
        },
      },
    ],
  },
  fmt: { semi: false, singleQuote: true, printWidth: 160 },
})
