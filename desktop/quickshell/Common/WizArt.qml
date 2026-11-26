pragma Singleton
import QtQuick
import Quickshell
import "WizRig.js" as Rig

// What every Wiz on screen shares (docs/assistant.md): the rig, and his magic
// in the theme's accent.
//
// The rig is imported here and nowhere else in the shell. A script imported
// by a component is loaded again for every instance of it, inline components
// included, and Assistant/Wiz.qml is built of well over a hundred.
//
// His layers are still pictures in Cybex blue (assets/wiz). For any other
// accent, the layers that carry magic (WizRig.LAYERS[...].accent) are drawn
// again from the rig, once per accent, and handed to Image as data: URLs.
// Nothing here runs per frame: a change of accent redraws each layer once.
Singleton {
    id: root

    readonly property var wiz: Rig.WizRig
    // "#RRGGBB".
    readonly property string accent: wiz.colour(Theme.accent.toString())
    readonly property bool tinted: accent !== wiz.COLORS.magic
    // Pixels per rig unit the pictures made here are sized for. Image draws an
    // SVG it is handed as data at the size asked only when that is smaller
    // than the picture's own, so this is larger than any Wiz is shown.
    readonly property int scale: 24
    // Layer name to picture, for the layers the accent recolours.
    readonly property var sources: tinted ? pictures(accent) : ({})

    function url(svg) {
        return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    }

    function pictures(colour) {
        const made = {};
        for (const name in wiz.LAYERS) {
            if (wiz.LAYERS[name].accent)
                made[name] = url(wiz.layerSVG(name, { accent: colour, scale: scale }));
        }
        return made;
    }

    // The progress ring's arc, `sixtieths` of the way round, in the colour of
    // the star's `light`.
    function arc(sixtieths, light) {
        return url(wiz.arcSVG(sixtieths / 60, { light: light, accent: accent, scale: scale }));
    }
}
