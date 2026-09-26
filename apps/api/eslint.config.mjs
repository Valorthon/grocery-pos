// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'eslint.config.mjs',
            'dist/**',
            'node_modules/**',
            'coverage/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintPluginPrettierRecommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
            sourceType: 'module',
            parserOptions: {
                projectService: {
                    // Plain Node scripts (the build's dist check) sit outside
                    // tsconfig.json; lint them with the default project.
                    allowDefaultProject: ['scripts/*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-unsafe-argument': 'error',

            'prettier/prettier': ['error', { endOfLine: 'auto' }],
        },
    },
    {
        // Test doubles legitimately trip several type-checked rules: mocks are
        // declared async without awaiting, jest.Mock members get passed around
        // unbound, and casts to partial shapes look redundant to the checker.
        files: ['**/*.spec.ts'],
        rules: {
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/unbound-method': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
        },
    },
);
