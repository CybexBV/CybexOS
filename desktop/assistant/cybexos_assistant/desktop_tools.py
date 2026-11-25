"""Desktop tool execution, shell RPC forwarding, Flathub and Wallhaven helpers."""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import secrets
import shutil
import time
import urllib.parse
import urllib.request

from . import desktop, policy, prompt, steps
from .protocol import LOG, encode, notification

SHELL_TIMEOUT = 30.0
# Downloading a wallpaper takes longer than flipping a setting.
SHELL_SLOW_TIMEOUT = 180.0
FLATHUB_TIMEOUT = 900.0
WALLHAVEN = "https://wallhaven.cc/api/v1"


class DesktopError(Exception):
    pass


class DesktopToolsMixin:
    """Desktop tool dispatch for agent MCP calls."""

    async def desktop_call(self, params):
        """A desktop tool the agent called through mcp.py: {isError, text}."""
        name = desktop.tool_name(params.get("tool"))
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        lane = self.lanes.get(params.get("lane") or "main")
        if lane is None or not lane.busy() or lane.turn is None:
            return {"isError": True, "text": "No question is in progress, so the desktop tools are not available."}
        turn = lane.turn
        problem = desktop.validate(name, arguments)
        if problem:
            return {"isError": True, "text": problem}
        spec = desktop.TOOLS[name]
        decision = await self._desktop_decision(name, spec, arguments)
        answer, note = await turn.authorize(decision)
        if answer not in ("allow", "always"):
            return {"isError": True, "text": note or "The person declined this."}
        turn.add_step(steps.entry(spec["label"], desktop.detail(name, arguments), tool=True))
        turn.set_step(desktop.PRESENT.get(name, "Working"))
        try:
            result = await self._desktop(name, arguments, turn)
        except DesktopError as error:
            return {"isError": True, "text": str(error)}
        except Exception as error:
            LOG.exception("desktop tool %s failed", name)
            return {"isError": True, "text": str(error) or "The tool failed."}
        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        return {"isError": False, "text": text[:60000]}

    async def _desktop_decision(self, name, spec, arguments):
        kind = spec["kind"]
        if kind == desktop.LOOK:
            return policy.allow()
        if kind == desktop.INSTALL:
            app = arguments.get("id", "")
            label = arguments.get("name") or app
            verb = "Install" if name == "flatpak_install" else "Remove"
            card = {"kind": "other", "title": f"{verb} {label}?", "detail": "",
                    "facts": [{"label": "App", "value": f"{label} · {app}" if label != app else app},
                              {"label": "From", "value": "Flathub"},
                              {"label": "For", "value": "Your account only"}],
                    "glyph": "download" if verb == "Install" else "delete"}
            return policy.Decision("ask", card=card, key=("flatpak", name, app), changes=True)
        if spec.get("always_ask"):
            window = {}
            with contextlib.suppress(DesktopError, TimeoutError):
                window = await self._ask_shell("window_info", {"address": arguments.get("address", "")}, 5)
            title = window.get("title") if isinstance(window, dict) else ""
            card = {"kind": "other", "title": "Close this window?",
                    "detail": "The app may have unsaved work.",
                    "facts": [{"label": "Window", "value": title or arguments.get("address", "")}]
                    + ([{"label": "App", "value": window["app"]}] if isinstance(window, dict) and window.get("app") else []),
                    "glyph": "close"}
            return policy.Decision("ask", card=card, always=True, changes=True)
        return policy.Decision("allow", changes=True)

    async def _desktop(self, name, arguments, turn):
        spec = desktop.TOOLS[name]
        if spec["where"] == "shell":
            if name == "wallpaper_set" and arguments.get("wallhaven"):
                arguments = dict(arguments, record=await self._wallpaper_record(arguments["wallhaven"]))
            timeout = SHELL_SLOW_TIMEOUT if name == "wallpaper_set" else SHELL_TIMEOUT
            return await self._ask_shell(name, arguments, timeout)
        if name == "wallpaper_search":
            return await asyncio.to_thread(self._wallhaven_search, arguments["query"])
        if name == "software_search":
            found = await self._cybex(["software", "flathub", "search", arguments["query"]], 60)
            rows = found.get("results") if isinstance(found, dict) else []
            return {"results": [{key: row.get(key) for key in ("id", "name", "summary", "developer")
                                 if key in row} for row in (rows or [])[:12] if isinstance(row, dict)]}
        if name in ("flatpak_install", "flatpak_remove"):
            app = arguments["id"]
            label = arguments.get("name") or app
            action = "install" if name == "flatpak_install" else "remove"
            await self._flathub(action, app, label)
            entry = self.changes.add(turn, "app", "app:" + app, app={"id": app, "name": label},
                                     op="installed" if action == "install" else "removed")
            self.changes.save()
            self.publish_changes()
            return {"done": True, "change": entry["id"]}
        if name == "doctor_run":
            return await self._cybex(["doctor", "--json"], 180)
        if name == "routine_list":
            return {"routines": self.routines.summaries()}
        if name == "routine_create":
            routine, error = self.routines.create(arguments["question"], arguments["schedule"],
                                                  arguments.get("title"), arguments.get("notify"), turn.agent,
                                                  version=prompt.release(self.release_path))
            if error:
                raise DesktopError(error)
            turn.routines.append({"id": routine["id"], "title": routine["title"],
                                  "schedule": routine["schedule"], "notify": routine["notify"]})
            self.changes.add(turn, "routine", "routine:" + routine["id"], op="created",
                             routine={"id": routine["id"], "title": routine["title"]})
            self.changes.save()
            self.publish_routines()
            self.publish_changes()
            return {"routine": routine}
        if name == "routine_delete":
            routine = self.routines.delete(arguments["id"])
            if routine is None:
                raise DesktopError("That routine no longer exists.")
            self.changes.add(turn, "routine", "routine:" + routine["id"], op="deleted",
                             routine={"id": routine["id"], "title": routine["title"], "data": routine})
            self.changes.save()
            self.publish_routines()
            self.publish_changes()
            return {"deleted": routine["id"]}
        raise DesktopError(f"{name} is not available.")

    async def _ask_shell(self, tool, arguments, timeout):
        shells = [client for client in self.clients if client.kind == "quickshell" and not client.closed]
        if not shells:
            raise DesktopError("The desktop shell is not running, so this cannot be done now.")
        identifier = "d-" + secrets.token_hex(8)
        future = asyncio.get_running_loop().create_future()
        self.desktop_pending[identifier] = future
        frame = encode(notification("desktop.request", {"id": identifier, "tool": tool, "arguments": arguments}))
        for client in shells:
            client.send(frame)
        try:
            answer = await asyncio.wait_for(future, timeout)
        except TimeoutError:
            raise DesktopError("The desktop did not answer in time.") from None
        finally:
            self.desktop_pending.pop(identifier, None)
        if not answer.get("ok"):
            raise DesktopError(str(answer.get("error") or "The desktop could not do that."))
        return answer.get("result")

    async def desktop_respond(self, params):
        future = self.desktop_pending.get(params.get("id"))
        if future is None or future.done():
            return {"ok": False}
        future.set_result({"ok": bool(params.get("ok")), "result": params.get("result"),
                           "error": params.get("error")})
        return {"ok": True}

    async def _cybex(self, args, timeout):
        """`cybex …` with JSON output, run as the person."""
        executable = shutil.which("cybex", path=self.agent_env()["PATH"]) or "cybex"
        try:
            process = await asyncio.create_subprocess_exec(
                executable, *args, cwd=str(self.home), env=self.agent_env(), stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        except OSError as error:
            raise DesktopError(f"cybex could not run: {error}") from None
        try:
            output, errors = await asyncio.wait_for(process.communicate(), timeout)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            raise DesktopError("cybex took too long.") from None
        text = output.decode("utf-8", "replace")
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            value = None
        if process.returncode != 0 and value is None:
            raise DesktopError((errors.decode("utf-8", "replace").strip() or text.strip()
                                or f"cybex failed with status {process.returncode}.")[:800])
        return value if value is not None else text[:30000]

    async def _flathub(self, action, app, label):
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,255}", app or ""):
            raise DesktopError("That is not a Flathub app id.")
        started = await self._cybex(["software", "flathub", action, "--names", json.dumps({app: label}), app], 60)
        task = started.get("task") if isinstance(started, dict) else None
        if not task:
            raise DesktopError(f"The {action} could not start.")
        deadline = time.monotonic() + FLATHUB_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(2)
            status = await self._cybex(["software", "flathub", "status"], 30)
            current = status.get("task") if isinstance(status, dict) else None
            if isinstance(current, dict) and current.get("id") == task:
                if current.get("state") == "done":
                    return
                if current.get("state") == "failed":
                    raise DesktopError(current.get("error") or f"The {action} failed.")
        raise DesktopError(f"The {action} is still running; Software shows how it ends.")

    def _wallhaven_get(self, path, query=None):
        url = f"{WALLHAVEN}/{path}" + ("?" + urllib.parse.urlencode(query) if query else "")
        request = urllib.request.Request(url, headers={"User-Agent": "Cybex OS Assistant"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read(2 * 1024 * 1024).decode("utf-8"))
        except (OSError, ValueError) as error:
            raise DesktopError(f"Wallhaven could not be reached: {error}") from None

    def _wallhaven_search(self, query):
        data = self._wallhaven_get("search", {"q": query, "categories": "100", "purity": "100",
                                              "sorting": "relevance", "atleast": "1920x1080"})
        rows = data.get("data") if isinstance(data, dict) else []
        results = []
        for row in (rows or [])[:10]:
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                continue
            self.wallpapers[row["id"]] = row
            results.append({"id": row["id"], "resolution": row.get("resolution"), "colors": row.get("colors"),
                            "page": row.get("url"), "thumbnail": (row.get("thumbs") or {}).get("small")})
        return {"results": results}

    async def _wallpaper_record(self, identifier):
        if not re.fullmatch(r"[a-z0-9]{4,12}", identifier or ""):
            raise DesktopError("That is not a Wallhaven id.")
        record = self.wallpapers.get(identifier)
        if record is None:
            data = await asyncio.to_thread(self._wallhaven_get, f"w/{identifier}")
            record = data.get("data") if isinstance(data, dict) else None
            if not isinstance(record, dict):
                raise DesktopError("Wallhaven has no such wallpaper.")
            if record.get("purity") != "sfw":
                raise DesktopError("Only safe-for-work wallpapers can be set.")
        return record
