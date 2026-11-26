"""Short, human-readable lines for the working pill."""

from __future__ import annotations

import os
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
    if kind in (desktop.CHANGE, desktop.ACT):
        return CHANGE
    if kind == desktop.INSTALL:
        return INSTALL
    return TOOL


def command_kind(command, depth=0):
    """`install` for a command that stages or applies a system change or adds
    or removes an app; `run` for any other."""
    from . import policy
    for argv in policy.segments(str(command or "")) or []:
        words = list(argv)
        while words and (("=" in words[0] and not words[0].startswith("=")) or os.path.basename(words[0]) == "env"):
            words.pop(0)
        if not words:
            continue
        name = os.path.basename(words[0])
        if name in policy.SHELLS and len(words) >= 3 and words[1] in SHELL_FLAGS and depth < 3:
            if command_kind(words[2], depth + 1) == INSTALL:
                return INSTALL
            continue
        verbs = [word for word in words[1:] if not word.startswith("-")]
        if name == "cybex" and (verbs[:2] in (["update", "stage"], ["software", "stage"], ["update", "apply"])
                                or verbs[:3] in (["software", "flathub", "install"],
                                                 ["software", "flathub", "remove"])):
            return INSTALL
        if name == "flatpak" and verbs[:1] in (["install"], ["uninstall"]):
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
