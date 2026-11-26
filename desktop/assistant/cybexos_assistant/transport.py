"""Socket client framing, execution lanes and attachment validation."""

from __future__ import annotations

import asyncio
import contextlib
import os
from pathlib import Path

from . import policy, prompt
from .protocol import LOG, MAX_CLIENT_BACKLOG, MAX_SCREENSHOT, RpcFault

MAX_ATTACHMENTS = 8
MAX_FILE = 256 * 1024
ATTACHMENT_KINDS = ("window", "selection", "file", "image", "text")
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif")


def turn_context(value):
    """turn.start's context for the per-turn note; an unknown purpose is dropped."""
    value = value if isinstance(value, dict) else {}
    context = {key: value[key] for key in ("output", "speak", "language") if key in value}
    if isinstance(value.get("purpose"), str) and value["purpose"] in prompt.PURPOSE_NOTES:
        context["purpose"] = value["purpose"]
    return context


def unit_identity(path):
    """The store file the user unit resolves to. NixOS links each unit to its
    own store path, so the identity changes exactly when its text does."""
    try:
        return os.path.realpath(path, strict=True)
    except (OSError, ValueError):
        return None


def validate_screenshot(shots_dir, value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise RpcFault(-32602, "Invalid screenshot")
    try:
        real = Path(value).resolve(strict=True)
        root = shots_dir.resolve(strict=True)
    except OSError:
        raise RpcFault(-32602, "The screenshot is no longer available.") from None
    if not policy.under(str(real), str(root)) or real == root or not real.is_file() \
            or real.suffix.lower() not in IMAGE_SUFFIXES or real.stat().st_size > MAX_SCREENSHOT:
        raise RpcFault(-32602, "The screenshot must be a PNG or JPEG taken by the assistant.")
    return real


def collect_attachments(shots_dir, value, validate=None):
    """(text attachments for the note, images): what the person attached."""
    if value in (None, ""):
        return [], []
    if not isinstance(value, list) or len(value) > MAX_ATTACHMENTS:
        raise RpcFault(-32602, f"Attach at most {MAX_ATTACHMENTS} things to one question.")
    check_screenshot = validate or (lambda path: validate_screenshot(shots_dir, path))
    notes, images = [], []
    for item in value:
        if not isinstance(item, dict) or item.get("kind") not in ATTACHMENT_KINDS:
            raise RpcFault(-32602, "Invalid attachment")
        kind = item["kind"]
        label = " ".join(str(item.get("label") or "").split())[:200]
        if kind == "image":
            images.append(check_screenshot(item.get("path")))
            notes.append({"kind": "image", "label": label})
        elif kind == "file":
            path = item.get("path")
            if not isinstance(path, str) or not os.path.isabs(path):
                raise RpcFault(-32602, "Invalid file")
            try:
                if os.path.getsize(path) > MAX_FILE:
                    raise RpcFault(-32602, f"{os.path.basename(path)} is too large to attach (up to 256 KB).")
                text = Path(path).read_bytes().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                raise RpcFault(-32602, f"Only text files and images can be attached: "
                                       f"{os.path.basename(path)} is neither.") from None
            notes.append({"kind": "file", "label": label or os.path.basename(path), "text": text})
        elif kind == "window":
            notes.append({"kind": "window", "label": label})
        else:
            text = item.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            notes.append({"kind": kind, "label": label, "text": text[:MAX_FILE]})
    return notes, images


class Client:
    """One connection; frames are queued so a slow reader never blocks the others."""

    def __init__(self, writer):
        self.writer = writer
        self.queue = asyncio.Queue()
        self.closed = False
        # What the client called itself in hello: "quickshell" is the shell,
        # which carries out the desktop tools only it can.
        self.kind = ""
        self.task = asyncio.create_task(self._write())

    def send(self, frame):
        if self.closed:
            return
        if self.queue.qsize() >= MAX_CLIENT_BACKLOG:
            LOG.warning("disconnecting a client that stopped reading")
            self.close()
            return
        self.queue.put_nowait(frame)

    async def _write(self):
        try:
            while True:
                frame = await self.queue.get()
                self.writer.write(frame)
                await self.writer.drain()
        except (ConnectionError, OSError):
            self.close()

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.task.cancel()
        with contextlib.suppress(Exception):
            self.writer.close()


class Lane:
    """One question in progress at most, its agents and its conversation."""

    def __init__(self, name):
        self.name = name
        self.turn = None
        self.task = None
        # The conversation of the turn in progress, which receives the
        # agent's session id.
        self.active = None
        self.adapters = {}

    def busy(self):
        return self.task is not None and not self.task.done()
