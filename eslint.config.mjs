import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/coverage/**',
            'eslint.config.mjs',
            '**/*.config.{js,mjs}',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintPluginPrettierRecommended,
    {
        files: ['apps/api/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
    {
        files: ['apps/client/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
    {
        files: ['apps/client/**/*.vue'],
        plugins: {
            vue: pluginVue,
        },
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                sourceType: 'module',
            },
        },
        rules: {
            ...pluginVue.configs['flat/recommended'].rules,
            'no-undef': 'off',
            'vue/block-lang': ['error', { script: { lang: 'ts' } }],
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
        },
    },
    {
        rules: {
            'prettier/prettier': ['error', { endOfLine: 'auto' }],
        },
    },
);
