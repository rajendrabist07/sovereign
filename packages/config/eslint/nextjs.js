const base = require("./base");
const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({ baseDirectory: __dirname });

/** @type {import('eslint').Linter.Config[]} */
module.exports = [...base, ...compat.extends("next/core-web-vitals")];