.pragma library

// Pure dictation model, language, vocabulary and correction helpers for SettingsHelpers.js.
// Keep this file free of Qt APIs so QML and Node tests share the exact same rules.

// Dictation's speech models (docs/dictation.md): the small Whisper model every
// installation carries, and the two a person may download: Whisper turbo for
// every language, and Parakeet, faster and as accurate, for 25 European
// languages. Older saved choices (tiny, small, medium, large-v3) were never
// installed, so they fall back to the built-in model.
var DICTATION_MODEL_CHOICES = [
    { value: "base", label: "Standard" },
    { value: "large-v3-turbo", label: "Accurate" },
    { value: "parakeet", label: "Fast & accurate" }
];
var DICTATION_MODELS = DICTATION_MODEL_CHOICES.map(
    function(choice) { return choice.value; });

// Languages offered for dictation: those the shell can name (LocaleNames)
// that Whisper also transcribes, by their Whisper codes.
var DICTATION_LANGUAGES = [
    "en", "ar", "bg", "ca", "cs", "da", "de", "el", "es", "et", "eu", "fi", "fr", "gl",
    "he", "hi", "hr", "hu", "id", "is", "it", "ja", "ko", "lt", "lv", "nl", "nn", "no",
    "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "th", "tr", "uk", "vi", "zh"
];

// The languages Parakeet v3 transcribes (it tells them apart by itself),
// among those offered: a dictation in any other language needs Whisper.
var PARAKEET_LANGUAGES = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it", "lt",
    "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk"
];

function parakeetSupports(primary, secondary) {
    return PARAKEET_LANGUAGES.indexOf(primary) !== -1
        && (secondary === "off" || secondary === primary || PARAKEET_LANGUAGES.indexOf(secondary) !== -1);
}

// The names in the vocabulary, one per comma, as Settings shows them.
function dictationTerms(value) {
    return String(value || "").split(",").map(function(term) {
        return term.trim();
    }).filter(function(term, index, all) {
        return term !== "" && all.indexOf(term) === index;
    });
}

function dictationTermsLine(terms) {
    return dictationTerms((terms || []).join(",")).join(", ");
}

// Corrections: what dictation writes ("heard") and what to write instead.
var DICTATION_CORRECTIONS_MAX = 200;
var DICTATION_CORRECTION_LENGTH = 60;

function correctionText(value) {
    if (typeof value !== "string")
        return "";
    return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function dictationCorrectionsIn(value, fallback) {
    if (!(Array.isArray(value) || value instanceof Array))
        return fallback;
    var seen = {};
    var kept = [];
    value.forEach(function(rule) {
        if (!rule || typeof rule !== "object" || kept.length >= DICTATION_CORRECTIONS_MAX)
            return;
        var heard = correctionText(rule.heard);
        var write = correctionText(rule.write);
        if (heard === "" || write === "" || heard === write
                || heard.length > DICTATION_CORRECTION_LENGTH || write.length > DICTATION_CORRECTION_LENGTH)
            return;
        var key = heard.toLowerCase();
        if (seen[key])
            return;
        seen[key] = true;
        kept.push({ heard: heard, write: write });
    });
    return kept;
}

// The same replacement scripts/dictation.py makes before typing, for the
// live words: whole words, any case.
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyDictationCorrections(text, rules) {
    var result = String(text || "");
    (rules || []).forEach(function(rule) {
        var heard = correctionText(rule && rule.heard);
        var write = correctionText(rule && rule.write);
        if (heard === "" || write === "" || heard === write)
            return;
        var words = heard.split(" ").map(escapeRegExp).join("\\s+");
        // Letters of the Latin, Greek and Cyrillic scripts: QML's engine
        // has no Unicode property escapes.
        var letter = "A-Za-z0-9_\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF'\\u2019-";
        var pattern = new RegExp("(^|[^" + letter + "])(" + words + ")(?![" + letter + "])", "gi");
        result = result.replace(pattern, function(_match, before) {
            return before + write;
        });
    });
    return result;
}

// The words a person wants recognised, as one line Whisper reads as context.
function dictationVocabularyIn(value, fallback) {
    if (typeof value !== "string")
        return fallback;
    var line = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return line.length <= 400 ? line : fallback;
}

var exported = {
    DICTATION_MODEL_CHOICES: DICTATION_MODEL_CHOICES,
    DICTATION_MODELS: DICTATION_MODELS,
    DICTATION_LANGUAGES: DICTATION_LANGUAGES,
    PARAKEET_LANGUAGES: PARAKEET_LANGUAGES,
    parakeetSupports: parakeetSupports,
    dictationTerms: dictationTerms,
    dictationTermsLine: dictationTermsLine,
    DICTATION_CORRECTIONS_MAX: DICTATION_CORRECTIONS_MAX,
    DICTATION_CORRECTION_LENGTH: DICTATION_CORRECTION_LENGTH,
    correctionText: correctionText,
    dictationCorrectionsIn: dictationCorrectionsIn,
    escapeRegExp: escapeRegExp,
    applyDictationCorrections: applyDictationCorrections,
    dictationVocabularyIn: dictationVocabularyIn
};

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
