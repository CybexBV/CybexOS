const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { shellDir } = require('./shell.cjs');
const read = name => fs.readFileSync(path.join(shellDir, name), 'utf8');

test('a successful status containing a domain error still settles and publishes its snapshot', () => {
    const source = read('Common/JsonCommand.qml');
    const handler = source.match(/onCompleted: (\(code, body, diagnostics\) => \{[\s\S]*?)\n        }\n    }/)[1] + '\n}';
    const completions = [], failures = [];
    const root = {completed: value => completions.push(value), failed: value => failures.push(value)};
    const complete = vm.runInNewContext('(' + handler + ')', {root});
    complete(0, '{"state":"failed","error":"Review is stale","recoveryPending":true}', '');
    assert.equal(completions.length, 1);
    assert.equal(completions[0].recoveryPending, true);
    assert.equal(failures.length, 0);
    complete(1, '', '{"error":"Authentication cancelled"}');
    assert.deepEqual(failures, ['Authentication cancelled']);
});

test('a catalogue refresh drops satisfied requests and forgets checks from an older configuration', () => {
    const source = read('Common/Software.qml');
    const handler = source.match(/id: loader\s+onCompleted: (\(\) => \{[\s\S]*?)\n        }\n/)[1] + '\n}';
    const Helpers = require(path.join(shellDir, 'Common/SoftwareHelpers.js'));
    const root = {catalogue: {identity: 'old'}, checks: {gimp: {state: 'prebuilt'}}, loaded: false, loadError: '',
        queue: [{attribute: 'gimp', action: 'install'}, {attribute: 'krita', action: 'install'}]};
    // The handler reads loader.result: a `var` signal argument would carry
    // sequence-wrapped arrays.
    const loader = {result: null};
    const run = vm.runInNewContext('(' + handler + ')', {root, loader, Helpers, I18n: {tr: text => text}});
    const complete = value => { loader.result = value; run(); };
    complete({schema: 1, identity: 'new', desired: ['gimp'], apps: []});
    assert.equal(root.loaded, true);
    assert.deepEqual(Object.keys(root.checks), []);
    assert.deepEqual(Array.from(root.queue, row => row.attribute), ['krita']);
    complete({schema: 2});
    assert.match(root.loadError, /invalid catalogue/);
    assert.equal(root.catalogue.identity, 'new', 'an invalid answer keeps the last good catalogue');
});

test('cleanup preference drafts retain their original policy until explicitly discarded', () => {
    // The draft outlives the Recovery points tab (RetentionDraft), so the
    // header's Changes review sees it too.
    const source = read('Settings/RetentionDraft.qml');
    const root = {policyBaseline:{automatic:false, keepConfirmed:5, keepDays:30}, draft:{automatic:true, keepConfirmed:5, keepDays:30},
        status:{policy:{automatic:false, keepConfirmed:10, keepDays:60}}};
    root.configuredPolicy = root.status.policy;
    vm.createContext(root);
    for (const name of ['same', 'discard', 'edit'])
        vm.runInContext(source.match(new RegExp(`^    function ${name}\\([^]*?^    }`, 'm'))[0], root);
    assert.equal(root.same(root.policyBaseline, root.status.policy), false);
    root.edit({keepDays:90});
    assert.equal(root.policyBaseline.keepDays, 30);
    root.discard();
    assert.equal(root.draft.keepConfirmed, 10);
    assert.equal(root.same(root.draft, root.policyBaseline), true);
});

test('one rule for the words: adding queues a NixOS app, Install starts installing now', () => {
    const action = read('Software/AppAction.qml');
    assert.match(action, /: I18n\.tr\("Add to queue"\)/, 'a catalogue app joins the queue');
    assert.match(action, /mode === "added" \? I18n\.tr\("In queue"\)/, 'an obvious queued state');
    // Install appears only where pressing it starts installing: an app's own
    // page while nothing else is queued or in flight, which adds the app and
    // makes the queue bar's own call.
    assert.match(action, /: installsNow \? I18n\.tr\("Install"\)/);
    assert.match(action, /readonly property bool installsNow: direct && mode === "install" && Software\.loaded\s*&& Software\.queue\.length === 0 && Software\.phase === "idle" && Software\.blockReason === ""/);
    assert.match(action, /\} else if \(installsNow\) \{\s*Software\.toggleInstall\(attribute\);\s*Software\.install\(\);/);
    assert.equal([...action.matchAll(/I18n\.tr\("Install"\)/g)].length, 1, 'Install is said in one place only');
    assert.match(read('Software/AppPage.qml'), /objectName: "softwareAppPrimary"[\s\S]*?direct: true/,
        "an app's own page installs directly");
    for (const name of ['Software/AppCard.qml', 'Software/AppRow.qml', 'Software/PickCard.qml', 'Software/HeroCarousel.qml'])
        assert.doesNotMatch(read(name), /direct: true/, `${name}: cards and lists keep Add to queue`);
    assert.match(read('Software/PackageRow.qml'), /I18n\.tr\("Add to queue"\)/);
    assert.match(read('Software/CollectionCard.qml'), /I18n\.tr\("Add all to queue"\)/);
    // Install is the queue bar's commit, and a Flathub app's immediate install.
    assert.match(read('Software/QueueBar.qml'), /I18n\.tr\("Install 1 app"\) : I18n\.format\("Install %1 apps"/);
    assert.match(read('Software/FlathubAction.qml'), /mode === "install" \? I18n\.tr\("Install"\)/);
});

test('badges say where an app comes from in plain words, and its page explains it', () => {
    for (const name of ['Software/AppCard.qml', 'Software/AppPage.qml', 'Software/InstalledRow.qml',
        'Software/DefaultOption.qml', 'Software/PackageRow.qml', 'Software/ExplorePage.qml'])
        assert.doesNotMatch(read(name), /I18n\.(?:tr|format)\("(?:Prebuilt|Vendor download)[^"]*"/, name);
    const page = read('Software/AppPage.qml');
    assert.match(page, /objectName: "softwareAppSource"/);
    assert.match(page, /I18n\.tr\("Open source, from NixOS, which Cybex OS is built on\./);
    assert.match(read('Software/FlathubPage.qml'), /objectName: "softwareFlathubSource"/);
});

test('Explore leads with the featured apps; the default apps fold to one row', () => {
    const explore = read('Software/ExplorePage.qml');
    assert.ok(explore.indexOf('HeroCarousel {') < explore.indexOf('DefaultsSection {'), 'the hero comes first');
    const defaults = read('Software/DefaultsSection.qml');
    assert.match(defaults, /model: root\.expanded \? Software\.roles : Software\.roles\.slice\(0, root\.columns\)/);
    assert.match(defaults, /actionName: "softwareDefaultsMore"/);
    // One primary style everywhere (2026-11-24 review): the hero's main
    // action is the shell's accent primary, as on an app's page, edged in the
    // slide's ink; it steps back while the queue bar holds the primary.
    const hero = read('Software/HeroCarousel.qml');
    assert.match(hero, /primary: \(heroAction\.mode === "install" \|\| heroAction\.mode === "open"\)\s*&& Software\.queue\.length === 0 && !Software\.flowActive/);
    assert.doesNotMatch(hero, /solidFill|solidInk/);
    const button = read('Software/SoftwareButton.qml');
    assert.match(button, /color: primary \? Theme\.accent/);
    assert.match(button, /\(queued \|\| quiet \|\| \(primary && custom\)\) \? 1 : 0/);
});

test("Software's chrome and states follow the shell's vocabulary", () => {
    // The same small header Close as Settings.
    const header = read('Software/HeaderBar.qml');
    assert.match(header, /SettingsUi\.SettingsAction \{\s*id: closeAction\s*objectName: "softwareClose"[\s\S]*?compact: true\s*glyph: "close"\s*text: I18n\.tr\("Close"\)\s*onTriggered: Software\.close\(\)/);
    // Keyboard rings only for keyboard modality, never a raw activeFocus border.
    for (const name of ['Software/HeaderBar.qml', 'Software/SoftwareButton.qml', 'Software/AppCard.qml',
        'Software/CategoryTile.qml', 'Software/CategoryPage.qml', 'Software/DefaultCard.qml',
        'Software/CollectionCard.qml', 'Software/InstalledPage.qml', 'Software/DefaultOption.qml',
        'Software/PickCard.qml', 'Software/HeroCarousel.qml', 'Software/ScreenshotTile.qml']) {
        const source = read(name);
        assert.doesNotMatch(source, /border\.width: (?:\w+\.)?activeFocus \? 2/, name);
        assert.doesNotMatch(source, /visible: root\.activeFocus/, name);
        assert.match(source, /Theme\.focusWidth\(/, name);
    }
    // The selected filter is the shared selected chip, not a solid pill.
    const category = read('Software/CategoryPage.qml');
    assert.match(category, /color: selected \? Theme\.selectedFill/);
    assert.match(category, /selected \? Theme\.selectedMark : Theme\.stroke/);
    // A featured app's icon is drawn once.
    assert.match(read('Software/PickCard.qml'), /id: icon\s*visible: root\.shot !== ""/);
    assert.match(read('Software/HeroCarousel.qml'), /AppIcon \{\s*visible: slide\.shot !== ""/);
    // Summaries get two lines in a grid row.
    for (const name of ['Software/AppRow.qml', 'Software/CategoryTile.qml'])
        assert.match(read(name), /wrapMode: Text\.Wrap\s*maximumLineCount: 2/, name);
});

test('a failed change is named plainly; the worker message stays behind Details', () => {
    const bar = read('Software/QueueBar.qml');
    assert.match(bar, /readonly property string failureKind: Helpers\.failureKind\(Software\.failure\)/);
    assert.match(bar, /I18n\.format\("Couldn't download %1", \[names\]\)/);
    assert.doesNotMatch(bar, /return Software\.failure \|\|/, 'the raw message is not the detail line');
    // A blocked app makes no "ready to use" promise, and Flathub's version
    // stands beside the disabled action.
    const page = read('Software/AppPage.qml');
    assert.match(page, /if \(blocked\)\s*return I18n\.tr\("Open source, from NixOS, which Cybex OS is built on\. It updates with Software Update once it can be installed\."\)/);
    assert.match(page, /objectName: "softwareAppFlathubOpen"\s*visible: root\.blocked && root\.flathubOffer && !root\.viaFlathub/);
});
