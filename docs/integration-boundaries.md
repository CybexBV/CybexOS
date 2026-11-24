# Desktop integration boundaries

The public QML singletons remain compatible. Internally, transport lifetime,
domain state and view code have separate owners. The Hermes, GitHub, T3 Code,
Fusebox, Model Usage and Remote Server integrations left Cybex OS on
2026-11-24 and are [Cybex OS plugins](omarchy-plugin-compatibility.md#cybex-os-plugins)
now; their boundaries live in their own repositories.

- **Updates:** `desktop/quickshell/Common/Updates.qml` invokes the supported
  `cybex update` CLI and polls durable transaction status. The privileged updater
  owns staging and activation; reloading the shell does not interrupt its
  systemd worker. Apply requests name the reviewed transaction and token.
  Independent source errors remain visible instead of implying that an
  unreachable channel is current.

`CommandRequest` has `command`, `running`, `stdinEnabled`, `inputText`,
`timeoutMs`, `killGraceMs` and `timeoutMessage` inputs. Set the command and then
`running = true`. `completed(code, body, error)` fires once per request;
`available()` announces when the process slot is free. Launch failure has code
`-1`; timeout has code `124` and an empty body, including if a process printed
partial output before hanging. A second expiry sends SIGKILL. Do not launch the
next command while `running` is true. No command is retried by the transport.

Node behavior tests exercise the update and request contracts. They do not
establish real subprocess interruption or installed-service qualification.
Exercise those paths in isolated runtime tests before release.
