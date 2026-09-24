import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const layer = (files, banned, message) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: banned, message }] }],
  },
})

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  layer(['src/api/**'], ['**/core/*', '**/store/*', '**/ui/*', 'react', 'zustand*'], 'api — нижний слой'),
  layer(['src/core/**'], ['**/store/*', '**/ui/*', 'react', 'zustand*'], 'core не знает про React и store'),
  layer(['src/store/**'], ['**/ui/*', 'react'], 'store не знает про UI'),
)
