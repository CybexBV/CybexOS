"""Short, human-readable lines for the working pill."""

from __future__ import annotations

import os
import shlex
from urllib.parse import urlparse


def short(text, limit=60):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def basename(path):
    return os.path.basename(str(path).rstrip("/")) or str(path)


def running(command):
    return "Running " + short(command) if command else "Running a command"


def editing(path):
    return "Editing " + basename(path) if path else "Editing a file"


# ---- what kind of work a step is ---------------------------------------------
# The turn snapshot's `stepKind`, beside the pill's line, so the character can
# show it. Claude Code and Codex map the same way.

THINK, READ, SEARCH, WRITE, RUN = "think", "read", "search", "write", "run"
CHANGE, INSTALL, DELEGATE, TOOL = "change", "install", "delegate", "tool"
KINDS = (THINK, READ, SEARCH, WRITE, RUN, CHANGE, INSTALL, DELEGATE, TOOL)

CLAUDE_KINDS = {
    "Read": READ, "NotebookRead": READ, "WebFetch": READ, "Skill": READ,
    "WebSearch": SEARCH, "Grep": SEARCH, "Glob": SEARCH, "LS": SEARCH,
    "Edit": WRITE, "Write": WRITE, "MultiEdit": WRITE, "NotebookEdit": WRITE,
    "BashOutput": RUN, "KillShell": RUN, "KillBash": RUN,
    "TodoWrite": THINK, "ExitPlanMode": THINK, "ToolSearch": THINK,
    "Task": DELEGATE, "Agent": DELEGATE,
}
# Look-only desktop tools that search rather than read.
DESKTOP_SEARCH = frozenset({"settings_search", "wallpaper_search", "software_search"})
SHELL_FLAGS = ("-c", "-lc", "-cl", "-ec", "-ce")


def desktop_kind(name):
    """The kind of one of Cybex OS's own desktop tools (desktop.py)."""
    from . import desktop
    kind = desktop.kind(name)
    if kind == desktop.LOOK:
        return SEARCH if name in DESKTOP_SEARCH else READ
    # Acting on the desktop is a change too, though nothing is recorded:
    # opening an app, moving a window, opening Settings at a row for
    # settings_show. Wiz casts while the window opens; the small Wiz in
    # Settings does the pointing.
    if kind in (desktop.CHANGE, desktop.ACT):
        return CHANGE
    if kind == desktop.INSTALL:
        return INSTALL
    return TOOL


# env's options that take the next word as their value.
ENV_VALUE_OPTIONS = frozenset({"-u", "--unset", "-C", "--chdir", "-a", "--argv0"})
# cybex's options that take the next word as their value (lifecycle/cybexos/cli.py).
CYBEX_VALUE_OPTIONS = frozenset({"--scope", "--source", "--names"})
# What builds, stages or activates a system, or adds, removes or updates apps,
# in cybex's own command set (lifecycle/cybexos/cli.py): the guided `cybex
# update` (with no subcommand) is handled apart, as it only reads with --json.
CYBEX_INSTALLS = (
    ("update", "stage"), ("update", "apply"), ("update", "rollback"), ("update", "retry-failed"),
    ("apps", "install"), ("apps", "remove"), ("apps", "update"),
    ("software", "stage"),
    ("software", "flathub", "install"), ("software", "flathub", "remove"), ("software", "flathub", "update"),
)
# Flatpak's verbs that install, remove or update apps (remove is uninstall's alias).
FLATPAK_INSTALLS = frozenset({"install", "uninstall", "remove", "update"})


def unwrapped(words):
    """The command a word list runs, past variable assignments and `env` with its options."""
    words = list(words)
    while words:
        first = words[0]
        if "=" in first and not first.startswith(("=", "-")):
            words.pop(0)
            continue
        if os.path.basename(first) != "env":
            break
        words.pop(0)
        while words and words[0].startswith("-"):
            option = words.pop(0)
            if option == "--":
                break
            if option in ("-S", "--split-string") and words:
                try:
                    words = shlex.split(words.pop(0)) + words
                except ValueError:
                    return []
            elif option.startswith("--split-string="):
                try:
                    words = shlex.split(option.split("=", 1)[1]) + words
                except ValueError:
                    return []
            elif option in ENV_VALUE_OPTIONS and words:
                words.pop(0)
    return words


def cybex_installs(args):
    """Whether `cybex ARGS` installs (see CYBEX_INSTALLS), as cybex itself parses them."""
    positional, options = [], set()
    args = list(args)
    while args:
        word = args.pop(0)
        if word.startswith("-"):
            options.add(word.split("=", 1)[0])
            if word in CYBEX_VALUE_OPTIONS and args:
                args.pop(0)
        else:
            positional.append(word)
    if options & {"-h", "--help"}:
        return False
    if positional == ["update"]:
        # The guided update checks, prepares and applies; with --json it only prints the status.
        return "--json" not in options
    return any(tuple(positional[:len(verbs)]) == verbs for verbs in CYBEX_INSTALLS)


def command_kind(command, depth=0):
    """`install` for a command that builds, stages or activates a system, or
    adds, removes or updates an app; `run` for any other."""
    from . import policy
    for argv in policy.segments(str(command or "")) or []:
        words = unwrapped(argv)
        if not words:
            continue
        name = os.path.basename(words[0])
        if name in policy.SHELLS and len(words) >= 3 and words[1] in SHELL_FLAGS and depth < 3:
            if command_kind(words[2], depth + 1) == INSTALL:
                return INSTALL
            continue
        if name == "cybex" and cybex_installs(words[1:]):
            return INSTALL
        verbs = [word for word in words[1:] if not word.startswith("-")]
        if name == "flatpak" and verbs[:1] and verbs[0] in FLATPAK_INSTALLS:
            return INSTALL
    return RUN


def claude_kind(name, tool_input):
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    if name == "Bash":
        return command_kind(tool_input.get("command", ""))
    if name in CLAUDE_KINDS:
        return CLAUDE_KINDS[name]
    from . import desktop
    ours = desktop.tool_name(name) if name.startswith("mcp__") else ""
    return desktop_kind(ours) if ours else TOOL


def codex_kind(item):
    kind = item.get("type") if isinstance(item, dict) else None
    if kind == "commandExecution":
        return command_kind(item.get("command", ""))
    if kind == "fileChange":
        return WRITE
    if kind == "webSearch":
        return SEARCH
    if kind == "mcpToolCall":
        from . import desktop
        ours = desktop.tool_name(item.get("tool", ""))
        return desktop_kind(ours) if ours and item.get("server") in (None, desktop.SERVER) else TOOL
    if kind == "dynamicToolCall":
        return TOOL
    if kind in ("reasoning", "plan"):
        return THINK
    if kind == "imageView":
        return READ
    if kind == "collabAgentToolCall":
        return DELEGATE
    return ""


def claude_tool(name, tool_input):
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    if name == "Read":
        return "Reading " + basename(tool_input.get("file_path", "a file"))
    if name == "Bash":
        return running(tool_input.get("command", ""))
    if name in ("Edit", "Write", "MultiEdit"):
        return editing(tool_input.get("file_path", ""))
    if name == "NotebookEdit":
        return editing(tool_input.get("notebook_path", ""))
    if name == "WebSearch":
        return "Searching the web"
    if name == "WebFetch":
        host = urlparse(str(tool_input.get("url", ""))).hostname
        return "Reading " + host if host else "Reading a web page"
    if name in ("Grep", "Glob", "LS"):
        return "Searching files"
    if name == "TodoWrite":
        return "Planning"
    if name in ("Task", "Agent"):
        return "Delegating"
    if name == "Skill":
        skill = tool_input.get("skill") or tool_input.get("name") or tool_input.get("command")
        return f"Using the {short(skill, 30)} skill" if skill else "Using a skill"
    if name.startswith("mcp__"):
        from . import desktop
        ours = desktop.tool_name(name)
        if ours:
            return desktop.PRESENT[ours]
        return "Using " + short(name.split("__")[-1], 40)
    return "Using " + short(name, 40)


def codex_item(item):
    kind = item.get("type") if isinstance(item, dict) else None
    if kind == "commandExecution":
        return running(item.get("command", ""))
    if kind == "fileChange":
        changes = item.get("changes") or []
        first = changes[0].get("path") if changes and isinstance(changes[0], dict) else ""
        return editing(first) if len(changes) <= 1 else f"Editing {len(changes)} files"
    if kind == "webSearch":
        return "Searching the web"
    if kind == "mcpToolCall":
        from . import desktop
        ours = desktop.tool_name(item.get("tool", ""))
        if ours and item.get("server") in (None, desktop.SERVER):
            return desktop.PRESENT[ours]
        return "Using " + short(item.get("tool", "a tool"), 40)
    if kind == "dynamicToolCall":
        return "Using " + short(item.get("tool", "a tool"), 40)
    if kind == "reasoning":
        return "Thinking"
    if kind == "plan":
        return "Planning"
    if kind == "imageView":
        return "Looking at the screenshot"
    if kind == "collabAgentToolCall":
        return "Delegating"
    return ""


# ---- the step list ("What Wiz did") -----------------------------------------
# One entry per tool the agent used, in plain words, with what it was pointed
# at in grey: {"label": "Read a file", "detail": "shell.json", "tool": False}.
# `tool` marks Cybex OS's own desktop tools (desktop.py).

MAX_STEPS = 60


def entry(label, detail="", tool=False):
    return {"label": short(label, 60), "detail": short(detail, 60) if detail else "", "tool": bool(tool)}


def claude_record(name, tool_input):
    from . import desktop
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    ours = desktop.tool_name(name)
    if ours:
        return entry(desktop.TOOLS[ours]["label"], desktop.detail(ours, tool_input), tool=True)
    if name == "Read":
        return entry("Read a file", basename(tool_input.get("file_path", "")))
    if name == "Bash":
        return entry("Ran a command", tool_input.get("command", ""))
    if name in ("Edit", "MultiEdit", "NotebookEdit"):
        return entry("Edited a file", basename(tool_input.get("file_path") or tool_input.get("notebook_path") or ""))
    if name == "Write":
        return entry("Wrote a file", basename(tool_input.get("file_path", "")))
    if name == "WebSearch":
        return entry("Searched the web", tool_input.get("query", ""))
    if name == "WebFetch":
        return entry("Read a web page", urlparse(str(tool_input.get("url", ""))).hostname or "")
    if name in ("Grep", "Glob", "LS"):
        return entry("Searched files", tool_input.get("pattern", "") or tool_input.get("path", ""))
    if name in ("Task", "Agent"):
        return entry("Asked a helper", tool_input.get("description", ""))
    if name == "Skill":
        skill = tool_input.get("skill") or tool_input.get("name") or tool_input.get("command") or ""
        return entry("Used a skill", skill)
    if name in ("TodoWrite", "ToolSearch", "BashOutput", "KillShell", "KillBash", "ExitPlanMode"):
        return None
    if name.startswith("mcp__"):
        parts = name.split("__")
        return entry("Used " + (parts[-1] if parts else name), parts[1] if len(parts) > 2 else "")
    return entry("Used " + name)


def codex_record(item):
    from . import desktop
    kind = item.get("type") if isinstance(item, dict) else None
    if kind == "commandExecution":
        return entry("Ran a command", item.get("command", ""))
    if kind == "fileChange":
        changes = [change for change in item.get("changes") or [] if isinstance(change, dict)]
        if len(changes) == 1:
            return entry("Edited a file", basename(changes[0].get("path", "")))
        return entry(f"Edited {len(changes)} files") if changes else None
    if kind == "webSearch":
        return entry("Searched the web", item.get("query", ""))
    if kind in ("mcpToolCall", "dynamicToolCall"):
        tool = str(item.get("tool") or "")
        ours = desktop.tool_name(tool) if item.get("server") in (None, desktop.SERVER) else ""
        if ours:
            return entry(desktop.TOOLS[ours]["label"], desktop.detail(ours, item.get("arguments")), tool=True)
        return entry("Used " + (tool or "a tool"), item.get("server") or "")
    if kind == "imageView":
        return entry("Looked at an image")
    if kind == "collabAgentToolCall" and item.get("tool") == "spawnAgent":
        return entry("Asked a helper", item.get("prompt") or "")
    return None
