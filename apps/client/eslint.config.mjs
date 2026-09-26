import eslint from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    ...pluginVue.configs['flat/recommended'],
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    // Config files live in tsconfig.node.json, which the
                    // project service does not load from tsconfig.json.
                    allowDefaultProject: ['vite.config.ts', 'vitest.config.ts'],
                },
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
    },
    {
        files: ['*.vue', '**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                sourceType: 'module',
            },
        },
    },
    eslintPluginPrettierRecommended, // After the rule sets: turns off their formatting rules
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-undef': 'off',
            'vue/block-lang': [
                'error',
                {
                    script: {
                        lang: 'ts',
                    },
                },
            ],
            // Page and layout components have single-word names (Login, Sales).
            'vue/multi-word-component-names': 'off',
            'vue/html-self-closing': [
                'error',
                {
                    html: {
                        void: 'always',
                        normal: 'always',
                        component: 'always',
                    },
                },
            ],

            // Rethrowing a caught error (typed any/unknown) is fine; rejecting
            // with a literal is not.
            '@typescript-eslint/prefer-promise-reject-errors': [
                'error',
                { allowThrowingAny: true, allowThrowingUnknown: true },
            ],

            // Deferred to #27, which removes the client's `any`s. Types
            // imported from .vue files (e.g. ComboboxOption) also resolve to
            // an error type under typescript-eslint, which trips these.
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-redundant-type-constituents': 'off',

            'prettier/prettier': ['error', { endOfLine: 'auto' }],
        },
    },
    {
        // Test doubles trip several type-checked rules: mocks are declared
        // async without awaiting, vi.fn() members get passed around unbound,
        // and casts to partial shapes look redundant to the checker. Same
        // exemptions as the api.
        files: ['**/*.spec.ts', 'src/testing/**'],
        rules: {
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/unbound-method': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        },
    },
    {
        // This file is plain JS outside every tsconfig.
        files: ['eslint.config.mjs'],
        ...tseslint.configs.disableTypeChecked,
    },
);
