pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import "../Common"
import "../Common/AssistantHelpers.js" as AssistantHelpers
import "../Common/NotesHelpers.js" as NotesHelpers

// A reply as Wiz shows it (docs/assistant.md), block by block
// (AssistantHelpers.markdownBlocks): paragraphs with room between them, a
// short line that introduces a list as a small label, a bullet list whose
// items start with a bold title as a grouped tile of rows, other lists with
// accent dots or numbers and a compact indent, and each fenced code block in
// its own well with the language and a Copy button. With `lead`, the first
// paragraph is the headline: its first sentence stands out. Inline Markdown
// is drawn as a small rich-text subset (AssistantHelpers.inlineHtml), `code`
// on a faint chip. Only web and mail links open; the agent wrote them.
Column {
    id: root

    property string text: ""
    property color color: Theme.textHi
    property bool plain: false
    // The first paragraph as the headline; the reply box sets it.
    property bool lead: false
    // A code block's and a group's corner; the box passes its inner corner.
    property real blockRadius: Theme.cardRadius
    readonly property var blocks: plain ? [{ kind: "plain", text: text }] : AssistantHelpers.markdownBlocks(text)
    // The link under the pointer in any block, for the cursor.
    property string hoveredLink: ""
    // How inline Markdown draws: the link colour, the code chip, the monospace face.
    readonly property var inlineStyle: ({ link: Theme.accentText.toString(), code: Theme.chipHover.toString(),
        mono: Theme.fontMono })
    readonly property var leadStyle: ({ link: Theme.accentText.toString(), code: Theme.chipHover.toString(),
        mono: Theme.fontMono, rest: Theme.textMid.toString() })

    function openLink(link) {
        if (/^(https?|mailto):/i.test(link))
            Quickshell.execDetached(["xdg-open", link]);
    }

    function html(markdown) {
        return AssistantHelpers.inlineHtml(markdown, root.inlineStyle);
    }

    // The space above a block: a label sits close to its list, and a label or
    // heading stands a little apart from what came before.
    function gapAbove(index) {
        if (index <= 0 || index >= root.blocks.length)
            return 0;
        const kind = root.blocks[index].kind;
        if (root.blocks[index - 1].kind === "label")
            return Theme.scaled(4);
        return kind === "label" || kind === "heading" ? Theme.scaled(14) : Theme.scaled(10);
    }

    spacing: 0

    Repeater {
        model: root.blocks

        delegate: Item {
            id: block
            required property var modelData
            required property int index
            readonly property real gap: root.gapAbove(index)

            width: root.width
            height: gap + loader.height

            Loader {
                id: loader
                y: block.gap
                width: block.width
                sourceComponent: {
                    switch (block.modelData.kind) {
                    case "code": return codeBlock;
                    case "heading": return headingBlock;
                    case "label": return labelBlock;
                    case "group": return groupBlock;
                    case "list": return listBlock;
                    case "quote": return quoteBlock;
                    case "table": return tableBlock;
                    case "rule": return ruleBlock;
                    case "plain": return plainBlock;
                    }
                    return textBlock;
                }
            }

            // A failed reply's message, exactly as written.
            Component {
                id: plainBlock

                TextEdit {
                    width: block.width
                    readOnly: true
                    selectByMouse: true
                    textFormat: TextEdit.PlainText
                    text: block.modelData.text
                    wrapMode: TextEdit.Wrap
                    color: root.color
                    selectionColor: Theme.accentSoft
                    selectedTextColor: Theme.textHi
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.control
                }
            }

            // A paragraph; the reply's first one may be its headline.
            Component {
                id: textBlock

                TextEdit {
                    readonly property string headline: root.lead && block.index === 0
                        ? AssistantHelpers.leadHtml(block.modelData.text, root.leadStyle) : ""

                    width: block.width
                    readOnly: true
                    selectByMouse: true
                    textFormat: TextEdit.RichText
                    text: headline !== "" ? headline : root.html(block.modelData.text)
                    wrapMode: TextEdit.Wrap
                    color: root.color
                    selectionColor: Theme.accentSoft
                    selectedTextColor: Theme.textHi
                    font.family: Theme.fontMenu
                    font.pixelSize: headline !== "" ? Theme.typography.title : Theme.typography.control
                    onLinkActivated: link => root.openLink(link)
                    onHoveredLinkChanged: root.hoveredLink = hoveredLink

                    HoverHandler {
                        cursorShape: parent.hoveredLink !== "" ? Qt.PointingHandCursor : Qt.IBeamCursor
                    }
                }
            }

            Component {
                id: headingBlock

                TextEdit {
                    width: block.width
                    readOnly: true
                    selectByMouse: true
                    textFormat: TextEdit.RichText
                    text: root.html(block.modelData.text)
                    wrapMode: TextEdit.Wrap
                    color: root.color
                    selectionColor: Theme.accentSoft
                    selectedTextColor: Theme.textHi
                    font.family: Theme.fontMenu
                    font.pixelSize: block.modelData.level <= 2 ? Theme.typography.title : Theme.typography.control
                    font.weight: Theme.weightSemibold
                    onLinkActivated: link => root.openLink(link)
                    onHoveredLinkChanged: root.hoveredLink = hoveredLink

                    HoverHandler {
                        cursorShape: parent.hoveredLink !== "" ? Qt.PointingHandCursor : Qt.IBeamCursor
                    }
                }
            }

            // "The details:" before a list, as the list's small name.
            Component {
                id: labelBlock

                // A name, not prose: drawn, not selectable.
                Text {
                    width: block.width
                    textFormat: Text.RichText
                    text: root.html(block.modelData.text)
                    wrapMode: Text.Wrap
                    color: Theme.textLow
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.metadata
                    font.weight: Theme.weightSemibold
                }
            }

            // Items that each start with a bold title: one tile, a row each.
            Component {
                id: groupBlock

                Rectangle {
                    width: block.width
                    height: groupColumn.implicitHeight
                    radius: root.blockRadius
                    color: Theme.cardFill
                    border.width: 1
                    border.color: Theme.hairline

                    Column {
                        id: groupColumn
                        width: parent.width

                        Repeater {
                            model: block.modelData.items

                            delegate: Item {
                                id: groupRow
                                required property var modelData
                                required property int index

                                width: groupColumn.width
                                height: rowColumn.implicitHeight + Theme.scaled(19)

                                Rectangle {
                                    visible: groupRow.index > 0
                                    width: parent.width
                                    height: 1
                                    color: Theme.hairline
                                }

                                Column {
                                    id: rowColumn
                                    x: Theme.scaled(12)
                                    y: Theme.scaled(9)
                                    width: parent.width - Theme.scaled(24)
                                    spacing: Theme.scaled(2)

                                    TextEdit {
                                        width: parent.width
                                        readOnly: true
                                        selectByMouse: true
                                        textFormat: TextEdit.RichText
                                        text: root.html(groupRow.modelData.title)
                                        wrapMode: TextEdit.Wrap
                                        color: Theme.textHi
                                        selectionColor: Theme.accentSoft
                                        selectedTextColor: Theme.textHi
                                        font.family: Theme.fontMenu
                                        font.pixelSize: Theme.typography.control
                                        font.weight: Theme.weightSemibold
                                        onLinkActivated: link => root.openLink(link)
                                        onHoveredLinkChanged: root.hoveredLink = hoveredLink
                                    }

                                    TextEdit {
                                        width: parent.width
                                        visible: groupRow.modelData.text !== ""
                                        readOnly: true
                                        selectByMouse: true
                                        textFormat: TextEdit.RichText
                                        text: root.html(groupRow.modelData.text)
                                        wrapMode: TextEdit.Wrap
                                        color: Theme.textMid
                                        selectionColor: Theme.accentSoft
                                        selectedTextColor: Theme.textHi
                                        font.family: Theme.fontMenu
                                        font.pixelSize: Theme.typography.control
                                        onLinkActivated: link => root.openLink(link)
                                        onHoveredLinkChanged: root.hoveredLink = hoveredLink

                                        HoverHandler {
                                            cursorShape: parent.hoveredLink !== "" ? Qt.PointingHandCursor
                                                : Qt.IBeamCursor
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Any other list: accent dots or numbers, a compact hanging indent.
            Component {
                id: listBlock

                Column {
                    id: listColumn
                    readonly property real gutter: block.modelData.ordered ? Theme.scaled(22) : Theme.scaled(14)

                    width: block.width
                    spacing: Theme.scaled(4)

                    Repeater {
                        model: block.modelData.items

                        delegate: Item {
                            id: listRow
                            required property var modelData

                            width: listColumn.width
                            height: itemText.implicitHeight

                            FontMetrics {
                                id: itemMetrics
                                font: itemText.font
                            }

                            Rectangle {
                                visible: !block.modelData.ordered
                                x: Theme.scaled(2)
                                y: Math.round(itemMetrics.height / 2 - height / 2)
                                width: Theme.scaled(5)
                                height: width
                                radius: width / 2
                                color: Theme.accent
                            }

                            Text {
                                visible: block.modelData.ordered
                                width: listColumn.gutter - Theme.scaled(6)
                                text: listRow.modelData.marker
                                horizontalAlignment: Text.AlignRight
                                color: Theme.textLow
                                font.family: Theme.fontMenu
                                font.pixelSize: Theme.typography.control
                                font.features: Theme.tabularNumberFeatures
                            }

                            TextEdit {
                                id: itemText
                                x: listColumn.gutter
                                width: parent.width - listColumn.gutter
                                readOnly: true
                                selectByMouse: true
                                textFormat: TextEdit.RichText
                                text: root.html(listRow.modelData.text)
                                wrapMode: TextEdit.Wrap
                                color: root.color
                                selectionColor: Theme.accentSoft
                                selectedTextColor: Theme.textHi
                                font.family: Theme.fontMenu
                                font.pixelSize: Theme.typography.control
                                onLinkActivated: link => root.openLink(link)
                                onHoveredLinkChanged: root.hoveredLink = hoveredLink

                                HoverHandler {
                                    cursorShape: parent.hoveredLink !== "" ? Qt.PointingHandCursor : Qt.IBeamCursor
                                }
                            }
                        }
                    }
                }
            }

            Component {
                id: quoteBlock

                Item {
                    width: block.width
                    height: quoteText.implicitHeight

                    Rectangle {
                        width: Theme.scaled(2)
                        height: parent.height
                        radius: width / 2
                        color: Theme.hairline
                    }

                    TextEdit {
                        id: quoteText
                        x: Theme.scaled(12)
                        width: parent.width - x
                        readOnly: true
                        selectByMouse: true
                        textFormat: TextEdit.RichText
                        text: root.html(block.modelData.text)
                        wrapMode: TextEdit.Wrap
                        color: Theme.textMid
                        selectionColor: Theme.accentSoft
                        selectedTextColor: Theme.textHi
                        font.family: Theme.fontMenu
                        font.pixelSize: Theme.typography.control
                        onLinkActivated: link => root.openLink(link)
                        onHoveredLinkChanged: root.hoveredLink = hoveredLink
                    }
                }
            }

            // Tables stay with Qt's own Markdown, which lays out their cells.
            Component {
                id: tableBlock

                TextEdit {
                    width: block.width
                    readOnly: true
                    selectByMouse: true
                    textFormat: TextEdit.MarkdownText
                    text: NotesHelpers.styleMarkdownLinks(block.modelData.text, Theme.accentText.toString())
                    wrapMode: TextEdit.Wrap
                    color: root.color
                    selectionColor: Theme.accentSoft
                    selectedTextColor: Theme.textHi
                    font.family: Theme.fontMenu
                    font.pixelSize: Theme.typography.control
                    onLinkActivated: link => root.openLink(link)
                    onHoveredLinkChanged: root.hoveredLink = hoveredLink
                }
            }

            Component {
                id: ruleBlock

                Item {
                    width: block.width
                    height: Theme.scaled(5)

                    Rectangle {
                        anchors.verticalCenter: parent.verticalCenter
                        width: parent.width
                        height: 1
                        color: Theme.hairline
                    }
                }
            }

            Component {
                id: codeBlock

                Rectangle {
                    width: block.width
                    height: codeHeader.height + codeText.contentHeight + Theme.scaled(16)
                    radius: root.blockRadius
                    color: Theme.well
                    border.width: 1
                    border.color: Theme.hairline
                    clip: true

                    Item {
                        id: codeHeader
                        width: parent.width
                        height: Theme.scaled(26)

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: Theme.scaled(9)
                            anchors.verticalCenter: parent.verticalCenter
                            text: block.modelData.lang
                            color: Theme.textFaint
                            font.family: Theme.fontMono
                            font.pixelSize: Theme.typography.metadata
                        }

                        AssistantButton {
                            id: copyCode
                            property bool copied: false
                            anchors.right: parent.right
                            anchors.rightMargin: Theme.scaled(2)
                            anchors.verticalCenter: parent.verticalCenter
                            glyph: copied ? "check" : "content_copy"
                            label: copied ? I18n.tr("Copied") : I18n.tr("Copy")
                            controlHeight: Theme.scaled(22)
                            color: "transparent"
                            onTriggered: {
                                Quickshell.clipboardText = block.modelData.text;
                                copied = true;
                                copiedReset.restart();
                            }

                            Timer {
                                id: copiedReset
                                interval: 1600
                                onTriggered: copyCode.copied = false
                            }
                        }

                        Rectangle {
                            anchors.bottom: parent.bottom
                            width: parent.width
                            height: 1
                            color: Theme.hairline
                        }
                    }

                    TextEdit {
                        id: codeText
                        x: Theme.scaled(10)
                        y: codeHeader.height + Theme.scaled(7)
                        width: parent.width - Theme.scaled(20)
                        readOnly: true
                        selectByMouse: true
                        textFormat: TextEdit.PlainText
                        text: block.modelData.text
                        wrapMode: TextEdit.WrapAnywhere
                        color: Theme.textHi
                        selectionColor: Theme.accentSoft
                        selectedTextColor: Theme.textHi
                        font.family: Theme.fontMono
                        font.pixelSize: Theme.typography.control
                    }
                }
            }
        }
    }
}
