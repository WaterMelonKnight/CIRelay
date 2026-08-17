import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  {
    // Type-aware rules require parser services, so they are scoped to TypeScript
    // files only. Applying them globally breaks linting of this config file.
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // vitest.config.ts sits outside every package tsconfig `include`.
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  prettier,
);
