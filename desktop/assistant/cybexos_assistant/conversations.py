"""Conversation history, undoable change log, speech and routine RPC handlers."""

from __future__ import annotations

import asyncio
import json
import re

from . import history as history_module, prompt
from .desktop_tools import DesktopError
from .protocol import BUSY, LOG, NOT_FOUND, UNAVAILABLE, RpcFault, now_ms

LANGUAGE = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$")
ROUTINE_TICK = 30.0


class ConversationsMixin:
    """RPC handlers for change undo, conversation history, speech and routines."""

    # ---- changes ---------------------------------------------------------------

    async def turn_undo(self, params):
        """Undoes everything one answer changed that can still be undone."""
        identifier = params.get("id")
        rows = [row for row in self.changes.summaries(self._exists, turn=identifier) if row["undoable"]]
        if not rows:
            raise RpcFault(NOT_FOUND, "There is nothing to undo.")
        restored, skipped = [], []
        for row in rows:
            entry = self.changes.get(row["id"])
            reason = await self._undo_entry(entry)
            shown = row.get("path") or "~/.config/cybexos/shell.json"
            (skipped if reason else restored).append(shown)
        self.publish_changes()
        return {"restored": sorted(set(restored)), "skipped": sorted(set(skipped))}

    async def change_list(self, params):
        if self.changes.enforce():
            self.changes.save()
        return {"changes": self.changes.summaries(self._exists)}

    async def change_undo(self, params):
        ids = params.get("ids") if isinstance(params.get("ids"), list) else [params.get("id")]
        if not ids or not all(isinstance(identifier, str) for identifier in ids):
            raise RpcFault(-32602, "Name the change to undo.")
        status = {row["id"]: row for row in self.changes.summaries(self._exists)}
        restored, skipped = [], []
        # Newest first, so one change never waits for another undone with it.
        for identifier in sorted(ids, key=lambda value: (status.get(value) or {}).get("at", 0), reverse=True):
            row = status.get(identifier)
            entry = self.changes.get(identifier)
            if row is None or entry is None:
                skipped.append({"id": identifier, "reason": "That change is no longer in the log."})
                continue
            if row["status"] == "blocked":
                skipped.append({"id": identifier, "reason": "A later change to the same thing comes first."})
                continue
            if row["status"] != "applied":
                skipped.append({"id": identifier, "reason": "It was changed since, so it was left as it is."
                                if row["status"] == "changed" else "It cannot be undone here."})
                continue
            reason = await self._undo_entry(entry)
            if reason:
                skipped.append({"id": identifier, "reason": reason})
            else:
                restored.append(identifier)
            status = {row["id"]: row for row in self.changes.summaries(self._exists)}
        self.publish_changes()
        return {"restored": restored, "skipped": skipped}

    async def _undo_entry(self, entry):
        """Empty string once undone, else why it could not be."""
        kind = entry["kind"]
        if kind in ("setting", "file", "plugin"):
            reason = self.changes.undo_local(entry)
        elif kind == "app":
            app = entry.get("app") or {}
            action = "remove" if entry.get("op") == "installed" else "install"
            try:
                await self._flathub(action, app.get("id", ""), app.get("name") or app.get("id", ""))
                reason = ""
            except DesktopError as error:
                reason = str(error)
        elif kind == "routine":
            data = (entry.get("routine") or {}).get("data")
            if entry.get("op") == "created":
                reason = "" if self.routines.delete(entry["routine"]["id"]) else "That routine is already gone."
            elif isinstance(data, dict):
                self.routines.items.append(data)
                self.routines.save()
                reason = ""
            else:
                reason = "That routine can no longer be restored."
            self.publish_routines()
        else:
            reason = "Software Update undoes system changes."
        if not reason:
            self.changes.mark_undone(entry)
        return reason

    # ---- the history ---------------------------------------------------------

    def _conversation(self, params):
        identifier = params.get("id")
        record = self.history.get(identifier) if isinstance(identifier, str) else None
        if record is None:
            raise RpcFault(NOT_FOUND, "That conversation is no longer in your history.")
        return record

    async def conversation_list(self, params):
        query = params.get("query") or ""
        if not isinstance(query, str) or len(query) > 200:
            raise RpcFault(-32602, "Invalid query")
        running = [lane.turn.conversation for lane in self.lanes.values() if lane.busy()]
        if self.history.enforce(keep=running[0] if len(running) == 1 else None) | self.changes.enforce():
            self.save()
            self.changes.save()
            self.publish_history()
        return {"conversations": self.summaries(query.strip())}

    async def conversation_open(self, params):
        """The whole conversation, the running answer included as it stands."""
        record = self._conversation(params)
        turns = list(record["turns"])
        live = None
        for lane in self.lanes.values():
            if lane.turn is not None and lane.turn.conversation == record["id"]:
                if turns and turns[-1]["id"] == lane.turn.id:
                    turns[-1] = self.history.entry(lane.turn)
                live = self.snapshot(lane.turn)
        return {"conversation": dict(self.history.summary(record, live), turns=turns,
                                     resumable=bool(record["session"]))}

    async def _stop_in(self, identifier=None):
        """Stops a running question when it belongs to `identifier` (any
        conversation when None) before that conversation is removed."""
        for lane in self.lanes.values():
            if lane.busy() and (identifier is None or lane.turn.conversation == identifier):
                await self.turn_stop({"lane": lane.name})

    async def conversation_delete(self, params):
        record = self._conversation(params)
        await self._stop_in(record["id"])
        if self.history.delete(record["id"]) is None:
            raise RpcFault(NOT_FOUND, "That conversation is no longer in your history.")
        self.memories.pop(record["id"], None)
        self.changes.forget_conversation(record["id"])
        if self.queue is not None and self.queue["conversation"] == record["id"]:
            await self.queue_remove({})
        self.save()
        self.publish_history()
        for lane in self.lanes.values():
            if lane.turn is not None and lane.turn.conversation == record["id"]:
                self._turn_event("updated", lane.turn)
        return {"ok": True}

    async def conversation_restore(self, params):
        identifier = params.get("id")
        record = self.history.restore(identifier) if isinstance(identifier, str) else None
        if record is None:
            raise RpcFault(NOT_FOUND, "That conversation can no longer be restored.")
        self.save()
        self.publish_history()
        for lane in self.lanes.values():
            if lane.turn is not None and lane.turn.conversation == record["id"]:
                self._turn_event("updated", lane.turn)
        return {"conversation": self.history.summary(record)}

    async def conversation_clear(self, params):
        """Every conversation, the change log and the last answer kept for
        the box. The agents' own session files are left alone."""
        await self.queue_remove({})
        await self._stop_in()
        self.history.clear()
        self.changes.clear()
        self.memories = {}
        for lane in self.lanes.values():
            lane.active = None
            lane.turn = None
        await self._close_adapters()
        self.save()
        self.publish("turn.updated", {"turn": None, "lane": "main"})
        self.publish("turn.updated", {"turn": None, "lane": "side"})
        self.publish_history()
        self.publish("changes.updated", {"count": 0})
        return {"ok": True}

    async def conversation_handoff(self, params):
        main = self.lanes["main"]
        identifier = params.get("id") or (main.turn.conversation if main.turn is not None else None)
        record = self.history.get(identifier) if isinstance(identifier, str) else None
        for lane in self.lanes.values():
            if lane.busy() and (record is None or lane.turn.conversation == record["id"]):
                raise RpcFault(BUSY, "Wait until the assistant has answered, then continue in a terminal.")
        if record is None or not record["session"]:
            raise RpcFault(UNAVAILABLE, "There is no conversation to continue.")
        agent, session = record["agent"], record["session"]
        executable = self.agents().get(agent) or agent
        argv = [executable, "--resume", session] if agent == "claude" else [executable, "resume", session]
        # The terminal continues the session from disk; a later question
        # here resumes it again instead of forking the history.
        for lane in self.lanes.values():
            adapter = lane.adapters.get(agent)
            if adapter is not None and adapter.conversation_id == session:
                lane.adapters.pop(agent)
                await adapter.close()
        return {"argv": argv, "cwd": str(self.home)}

    async def speech_say(self, params):
        text = params.get("text")
        if not isinstance(text, str) or len(text) > 64 * 1024:
            raise RpcFault(-32602, "Invalid text")
        language = params.get("language")
        if language is not None and (not isinstance(language, str) or not LANGUAGE.fullmatch(language)):
            language = None
        return await self.speaker.say(text, language)

    async def speech_stop(self, params):
        await self.speaker.stop()
        return {"ok": True}

    # ---- routines --------------------------------------------------------------

    async def routine_list(self, params):
        return {"routines": self.routines.summaries()}

    async def routine_create(self, params):
        routine, error = self.routines.create(params.get("question"), params.get("schedule"),
                                              params.get("title"), params.get("notify"), params.get("agent"),
                                              version=prompt.release(self.release_path))
        if error:
            raise RpcFault(-32602, error)
        if params.get("purpose") in prompt.PURPOSE_NOTES:
            routine["purpose"] = params["purpose"]
            self.routines.save()
        self.publish_routines()
        return {"routine": routine}

    async def routine_update(self, params):
        changes = {key: params[key] for key in ("question", "title", "notify", "enabled", "schedule") if key in params}
        routine, error = self.routines.update(params.get("id"), changes)
        if error:
            raise RpcFault(-32602 if routine is None and "exists" not in error else NOT_FOUND, error)
        self.publish_routines()
        return {"routine": routine}

    async def routine_delete(self, params):
        routine = self.routines.delete(params.get("id"))
        if routine is None:
            raise RpcFault(NOT_FOUND, "That routine no longer exists.")
        if routine["id"] in self.waiting_routines:
            self.waiting_routines.remove(routine["id"])
        self.publish_routines()
        return {"ok": True}

    async def routine_run(self, params):
        routine = self.routines.get(params.get("id"))
        if routine is None:
            raise RpcFault(NOT_FOUND, "That routine no longer exists.")
        if self.lanes["main"].busy() or self.queue is not None:
            if routine["id"] not in self.waiting_routines:
                self.waiting_routines.append(routine["id"])
            return {"started": False, "waiting": True}
        started = await self._start_routine(routine, raising=True)
        return {"started": started, "waiting": False}

    async def _start_routine(self, routine, raising=False):
        context = {"purpose": routine["purpose"]} if routine.get("purpose") in prompt.PURPOSE_NOTES else {}
        try:
            await self._begin(self.lanes["main"], routine["question"], routine.get("agent") or "auto", None, None,
                              context, [], [], routine=routine)
            return True
        except RpcFault as fault:
            self.routines.ran(routine, prompt.release(self.release_path),
                              {"status": "failed", "error": fault.message, "attention": True, "at": now_ms(),
                               "conversation": None, "summary": fault.message})
            self.publish_routines()
            self.publish("routine.finished", {"routine": {"id": routine["id"], "title": routine["title"]},
                                              "conversation": None, "attention": True, "notify": True,
                                              "summary": fault.message})
            if raising:
                raise
            return False

    def _routine_finished(self, turn, record):
        routine = self.routines.get(turn.routine["id"])
        summary = history_module.collapse(turn.error if turn.status == "failed" else turn.text, 200)
        notify = bool(turn.attention) or bool(routine and routine.get("notify") == "always")
        if routine is not None:
            self.routines.ran(routine, prompt.release(self.release_path),
                              {"status": turn.status, "attention": bool(turn.attention), "at": now_ms(),
                               "conversation": record["id"], "summary": summary})
            self.publish_routines()
        self.publish("routine.finished", {"routine": turn.routine, "conversation": record["id"],
                                          "attention": bool(turn.attention), "notify": notify, "summary": summary})

    async def _schedule(self):
        await asyncio.sleep(5)
        while not self.closing:
            try:
                version = prompt.release(self.release_path)
                before = json.dumps(self.routines.items, sort_keys=True)
                for routine in self.routines.due(now_ms(), version):
                    if routine["id"] not in self.waiting_routines:
                        self.waiting_routines.append(routine["id"])
                if json.dumps(self.routines.items, sort_keys=True) != before:
                    self.routines.save()
                if self.waiting_routines and not self.lanes["main"].busy() and self.queue is None:
                    await self._next()
            except Exception:
                LOG.exception("routine scheduling failed")
            await asyncio.sleep(ROUTINE_TICK)
