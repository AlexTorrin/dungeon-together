import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'assets/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['phaser', 'colyseus*', '@colyseus/*', 'node:*'] },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Используй RNG с seed из состояния.' },
        { object: 'Date', property: 'now', message: 'shared должен быть детерминированным.' },
      ],
    },
  },
);
