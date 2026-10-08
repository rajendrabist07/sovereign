
const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        ignores: [
            "**/dist/**",
            "**/.next/**",
            "**/.turbo/**",
            "**/node_modules/**",
            "**/eslint.config.js",
            "**/eslint.config.mjs",
            "**/next.config.*",
            "**/postcss.config.*",
            "**/tailwind.config.*"
        ]
    },
    {
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
            ],
            "no-console": ["warn", { allow: ["warn", "error"] }]
        }
    }
];