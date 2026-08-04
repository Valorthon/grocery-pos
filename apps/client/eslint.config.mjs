import eslint from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
    {
        // Ignore build outputs
        ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs['flat/recommended'], // Adds Vue 3 specific rules
    {
        files: ['*.vue', '**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser, // Tells Vue to use TS parser inside <script> blocks
                sourceType: 'module',
            },
        },
    },
    eslintPluginPrettierRecommended, // Must be last to override formatting rules
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
            // Vuetify components often trigger this. It's safe to turn off for Vuetify apps.
            'vue/multi-word-component-names': 'off',

            // Enforces self-closing tags in your Vue templates (e.g., <v-btn /> instead of <v-btn></v-btn>)
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

            'prettier/prettier': ['error', { endOfLine: 'auto' }],
        },
    },
);
