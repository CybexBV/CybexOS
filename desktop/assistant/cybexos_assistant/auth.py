"""Ask the agents about sign-in without reading or copying their credentials."""

from __future__ import annotations

import asyncio
import contextlib
import re

from .protocol import stop_process


STATUS_ARGS = {"claude": ["auth", "status"], "codex": ["login", "status"]}
LOGIN_ARGS = {"claude": ["auth", "login"], "codex": ["login"]}
STATUS_TIMEOUT = 8.0
# `codex login status` names how Codex is signed in on its first line ("Logged
# in using ChatGPT", "… an API key - sk-…", "… access token"). Only a ChatGPT
# plan has the Fast tier.
CODEX_SIGN_IN = re.compile(rb"Logged in using (\w+)")
MAX_STATUS_OUTPUT = 4096


def codex_plan(output):
    """"chatgpt", "other" or None (unknown) from `codex login status` output.

    Only the words after "Logged in using" are looked at; the rest, which can
    name the account or show part of a key, is dropped unread.
    """
    match = CODEX_SIGN_IN.search(output[:MAX_STATUS_OUTPUT] if isinstance(output, bytes) else b"")
    if match is None:
        return None
    return "chatgpt" if match.group(1).lower() == b"chatgpt" else "other"


async def status(agent, executable, home, env):
    """(state, plan): "ready", "required" or "unknown", and for Codex how it is
    signed in (codex_plan). Both CLIs document 0 for signed in and 1 for signed
    out.

    Their output can identify the account and does not belong in the socket,
    persisted assistant state or journal: Claude Code's is discarded, and of
    Codex's only the sign-in kind is kept. No model is invoked.
    """
    process = None
    read = agent == "codex"
    try:
        process = await asyncio.create_subprocess_exec(
            executable, *STATUS_ARGS[agent], cwd=home, env=env,
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE if read else asyncio.subprocess.DEVNULL, start_new_session=True)
        if read:
            _, output = await asyncio.wait_for(process.communicate(), STATUS_TIMEOUT)
        else:
            output = None
            await asyncio.wait_for(process.wait(), STATUS_TIMEOUT)
        code = process.returncode
        state = "ready" if code == 0 else "required" if code == 1 else "unknown"
        return state, codex_plan(output) if read and state == "ready" else None
    except (TimeoutError, OSError):
        return "unknown", None
    finally:
        if process is not None and process.returncode is None:
            with contextlib.suppress(Exception):
                await stop_process(process)
