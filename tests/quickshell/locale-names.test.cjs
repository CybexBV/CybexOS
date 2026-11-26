const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shellDir, load } = require('./shell.cjs');
const L = load('LocaleNames.js');
const I18nHelpers = load('I18nHelpers.js');
const nl = require(path.join(shellDir, 'Common/i18n/nl.js'));

// The same composition as I18n.localeName().
function localeName(value, catalog) {
    const found = L.names(value);
    if (!found) return value;
    const tr = text => I18nHelpers.translate(catalog, text);
    return found.territory ? I18nHelpers.format(catalog, '%1 (%2)', [tr(found.language), tr(found.territory)])
        : tr(found.language);
}

test('every installer language has a name, and the I18n singleton composes it the same way', () => {
    const installer = fs.readFileSync(path.join(shellDir, '../../installer/cybexos-installerd'), 'utf8');
    const locales = [...installer.matchAll(/\('([a-z]{2}_[A-Z]{2}\.UTF-8)', '/g)].map(match => match[1]);
    assert.ok(locales.length >= 14, locales);
    for (const value of locales) {
        const found = L.names(value);
        assert.ok(found && found.territory, value);
        assert.notEqual(localeName(value, nl.MESSAGES), localeName(value, {}), 'translated: ' + value);
    }
    const singleton = fs.readFileSync(path.join(shellDir, 'Common/I18n.qml'), 'utf8');
    assert.match(singleton, /function localeName\(value: string\): string \{[\s\S]*?LocaleNames\.names\(value\)[\s\S]*?root\.format\("%1 \(%2\)", \[root\.tr\(found\.language\), root\.tr\(found\.territory\)\]\)/);
    const hello = fs.readFileSync(path.join(shellDir, 'Welcome/HelloStep.qml'), 'utf8');
    assert.match(hello, /I18n\.localeName\(region\.locale\)/);
});
