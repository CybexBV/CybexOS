.pragma library
.import "NotifSmart.js" as Smart

// The desktop opener is a trust boundary: URLs can come from catalogues,
// release notes, plugin manifests and wallpaper sites, and must never select
// an arbitrary local protocol handler. Every link the shell opens takes the
// notifications' strict check (NotifSmart.js): HTTP(S) only, no user info,
// control or encoded control characters, or numeric-host tricks. Surrounding
// whitespace from catalogue data is trimmed first.

function safeHttpUrl(value) {
    return typeof value === "string" ? Smart.safeHttpUrl(value.trim()) : "";
}

var exported = { safeHttpUrl: safeHttpUrl };

if (typeof module !== "undefined" && module.exports)
    module.exports = exported;
