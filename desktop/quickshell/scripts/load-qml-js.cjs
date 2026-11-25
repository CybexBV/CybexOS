// Load a pure QML JS helper file in Node, resolving QML's .pragma and .import
// directives in the current V8 realm so plain objects match Node assertions.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadQmlJs(filePath, cache = {}) {
    const full = path.resolve(filePath);
    if (cache[full]) return cache[full];
    let source = fs.readFileSync(full, "utf8");
    if (!/^\.(?:pragma|import)\b/m.test(source)) {
        cache[full] = require(full);
        return cache[full];
    }
    const imports = [];
    source = source
        .replace(/^\.pragma [^\r\n]*(?:\r?\n|$)/gm, "")
        .replace(/^\.import "([^"]+)" as (\w+)[ \t]*(?:\r?\n|$)/gm, (_, rel, alias) => {
            imports.push([alias, loadQmlJs(path.resolve(path.dirname(full), rel), cache)]);
            return "";
        });
    const mod = { exports: {} };
    const params = ["module", "exports", ...imports.map(([alias]) => alias)];
    const values = [mod, mod.exports, ...imports.map(([, val]) => val)];
    const fn = vm.runInThisContext(
        `(function(${params.join(", ")}) {\n${source}\n})`,
        { filename: full }
    );
    fn(...values);
    cache[full] = mod.exports;
    return cache[full];
}

module.exports = loadQmlJs;
