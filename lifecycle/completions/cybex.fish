# Fish completions for the `cybex` CLI (Cybex OS)

function __cybex_using_subcommand
    set -l cmd (commandline -opc)
    set -e cmd[1]
    set -l words
    for tok in $cmd
        switch $tok
            case '-*'
                continue
            case '*'
                set -a words $tok
        end
    end
    set -l want_count (count $argv)
    if test $want_count -eq 0
        test (count $words) -eq 0
        return
    end
    test (count $words) -ge $want_count; or return 1
    for i in (seq 1 $want_count)
        test "$words[$i]" = "$argv[$i]"; or return 1
    end
    return 0
end

function __cybex_arg_count
    set -l cmd (commandline -opc)
    set -e cmd[1]
    set -l count 0
    for tok in $cmd
        switch $tok
            case '-*'
                continue
            case '*'
                set count (math $count + 1)
        end
    end
    echo $count
end

function __cybex_themes
    cybex theme list --json 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    for t in data.get("themes", []):
        print(f"{t[\"id\"]}\t{t.get(\"name\", \"\")} ({t.get(\"mode\", \"\")})")
except Exception:
    pass
'
end

function __cybex_plugins
    cybex plugin list --json 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    for p in data.get("plugins", []):
        state = "enabled" if p.get("enabled") else "disabled"
        print(f"{p[\"id\"]}\t{p.get(\"name\", \"\")} ({state})")
except Exception:
    pass
'
end

function __cybex_installed_apps
    cybex apps list --json 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    for pkg in (data.get("nix") or {}).get("desired") or []:
        print(f"{pkg}\tNix app")
    for app in (data.get("flathub") or {}).get("installed") or []:
        print(f"{app[\"id\"]}\t{app.get(\"name\", \"\")} (Flathub)")
except Exception:
    pass
'
end

# Disable default file completions unless a command accepts paths
complete -c cybex -f

# Global flags
complete -c cybex -n '__cybex_using_subcommand' -s h -l help -d 'Show help'
complete -c cybex -n '__cybex_using_subcommand' -s V -l version -d 'Show Cybex OS version'
complete -c cybex -l json -d 'Output machine-readable JSON'

# Top-level commands
complete -c cybex -n '__cybex_using_subcommand' -a status -d 'Overview of this computer'
complete -c cybex -n '__cybex_using_subcommand' -a update -d 'Check, prepare and apply updates'
complete -c cybex -n '__cybex_using_subcommand' -a doctor -d 'Run a read-only system check'
complete -c cybex -n '__cybex_using_subcommand' -a cleanup -d 'Free space from old generations'
complete -c cybex -n '__cybex_using_subcommand' -a backup -d 'Encrypted home-folder backups'
complete -c cybex -n '__cybex_using_subcommand' -a report -d 'Save a redacted bug report'
complete -c cybex -n '__cybex_using_subcommand' -a hardware -d 'Detected hardware and support status'
complete -c cybex -n '__cybex_using_subcommand' -a apps -d 'Search, install and remove apps'
complete -c cybex -n '__cybex_using_subcommand' -a theme -d 'Switch or share desktop themes'
complete -c cybex -n '__cybex_using_subcommand' -a plugin -d 'Manage bar widgets and plugins'
complete -c cybex -n '__cybex_using_subcommand' -a shell -d 'Desktop shell health and safe mode'
complete -c cybex -n '__cybex_using_subcommand' -a region -d 'Timezone and language settings'
complete -c cybex -n '__cybex_using_subcommand' -a ask -d 'Ask Wiz from the terminal'
complete -c cybex -n '__cybex_using_subcommand' -a agent -d 'Open your coding CLI'
complete -c cybex -n '__cybex_using_subcommand' -a assistant -d 'Control the Wiz assistant'
complete -c cybex -n '__cybex_using_subcommand' -a version -d 'Print the installed Cybex OS version'

# cybex update
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a check -d 'Check for available updates'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a status -d 'Show current update status'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a history -d 'List past deployments'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a stage -d 'Prepare an update without applying'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a apply -d 'Apply a prepared update'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a discard -d 'Discard a prepared update'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a rollback -d 'Restore a previous deployment'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a confirm -d 'Confirm a trial boot'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a log -d 'Show a deployment build log'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a channel -d 'Show or set release channel'
complete -c cybex -n '__cybex_using_subcommand update; and test (__cybex_arg_count) -eq 1' -a automatic -d 'Show or set automatic updates'
complete -c cybex -n '__cybex_using_subcommand update' -s y -l yes -d 'Apply without asking'
complete -c cybex -n '__cybex_using_subcommand update' -l scope -xa 'both cybexos upstream local firmware' -d 'Update scope'
complete -c cybex -n '__cybex_using_subcommand update stage' -a 'both cybexos upstream local firmware'
complete -c cybex -n '__cybex_using_subcommand update channel' -a 'stable beta'
complete -c cybex -n '__cybex_using_subcommand update automatic; and test (__cybex_arg_count) -eq 2' -a 'prepare confirm'
complete -c cybex -n '__cybex_using_subcommand update automatic; and test (__cybex_arg_count) -eq 3' -a 'on off'

# cybex apps
complete -c cybex -n '__cybex_using_subcommand apps; and test (__cybex_arg_count) -eq 1' -a list -d 'List installed apps'
complete -c cybex -n '__cybex_using_subcommand apps; and test (__cybex_arg_count) -eq 1' -a search -d 'Search Nix and Flathub apps'
complete -c cybex -n '__cybex_using_subcommand apps; and test (__cybex_arg_count) -eq 1' -a info -d 'Show details about an app'
complete -c cybex -n '__cybex_using_subcommand apps; and test (__cybex_arg_count) -eq 1' -a install -d 'Install one or more apps'
complete -c cybex -n '__cybex_using_subcommand apps; and test (__cybex_arg_count) -eq 1' -a remove -d 'Remove installed apps'
complete -c cybex -n '__cybex_using_subcommand apps; and test (__cybex_arg_count) -eq 1' -a updates -d 'Check for Flathub app updates'
complete -c cybex -n '__cybex_using_subcommand apps; and test (__cybex_arg_count) -eq 1' -a update -d 'Update installed Flathub apps'
complete -c cybex -n '__cybex_using_subcommand apps remove' -a '(__cybex_installed_apps)'
complete -c cybex -n '__cybex_using_subcommand apps list' -l all -d 'Include built-in system packages'
complete -c cybex -n '__cybex_using_subcommand apps' -l source -xa 'all nix flathub' -d 'Filter app source'
complete -c cybex -n '__cybex_using_subcommand apps install' -s y -l yes -d 'Install without asking'
complete -c cybex -n '__cybex_using_subcommand apps remove' -s y -l yes -d 'Remove without asking'

# cybex cleanup
complete -c cybex -n '__cybex_using_subcommand cleanup; and test (__cybex_arg_count) -eq 1' -a status -d 'Show disk space and retention policy'
complete -c cybex -n '__cybex_using_subcommand cleanup; and test (__cybex_arg_count) -eq 1' -a preview -d 'Check how much space can be freed'
complete -c cybex -n '__cybex_using_subcommand cleanup; and test (__cybex_arg_count) -eq 1' -a run -d 'Preview and clean old generations'
complete -c cybex -n '__cybex_using_subcommand cleanup; and test (__cybex_arg_count) -eq 1' -a pin -d 'Pin or unpin a recovery deployment'
complete -c cybex -n '__cybex_using_subcommand cleanup; and test (__cybex_arg_count) -eq 1' -a policy -d 'Show or change retention policy'
complete -c cybex -n '__cybex_using_subcommand cleanup; and test (__cybex_arg_count) -eq 1' -a resume -d 'Resume an interrupted cleanup'
complete -c cybex -n '__cybex_using_subcommand cleanup' -s y -l yes -d 'Clean without asking'

# cybex region
complete -c cybex -n '__cybex_using_subcommand region; and test (__cybex_arg_count) -eq 1' -a status -d 'Show current timezone and locale'
complete -c cybex -n '__cybex_using_subcommand region; and test (__cybex_arg_count) -eq 1' -a set -d 'Change timezone or locale'
complete -c cybex -n '__cybex_using_subcommand region; and test (__cybex_arg_count) -eq 1' -a timezones -d 'List available timezones'
complete -c cybex -n '__cybex_using_subcommand region; and test (__cybex_arg_count) -eq 1' -a locales -d 'List installed locales'
complete -c cybex -n '__cybex_using_subcommand region set' -l timezone -xa '(timedatectl list-timezones --no-pager 2>/dev/null)' -d 'Set timezone'
complete -c cybex -n '__cybex_using_subcommand region set' -l locale -xa '(locale -a 2>/dev/null | string replace ".utf8" ".UTF-8")' -d 'Set locale'
complete -c cybex -n '__cybex_using_subcommand region set' -s y -l yes -d 'Apply without asking'

# cybex theme
complete -c cybex -n '__cybex_using_subcommand theme; and test (__cybex_arg_count) -eq 1' -a list -d 'List built-in and user themes'
complete -c cybex -n '__cybex_using_subcommand theme; and test (__cybex_arg_count) -eq 1' -a apply -d 'Apply a theme'
complete -c cybex -n '__cybex_using_subcommand theme; and test (__cybex_arg_count) -eq 1' -a install -d 'Install a theme from a folder, archive or URL'
complete -c cybex -n '__cybex_using_subcommand theme; and test (__cybex_arg_count) -eq 1' -a export -d 'Export a theme or CURRENT appearance'
complete -c cybex -n '__cybex_using_subcommand theme; and test (__cybex_arg_count) -eq 1' -a remove -d 'Remove a user theme'
complete -c cybex -n '__cybex_using_subcommand theme apply' -a '(__cybex_themes)'
complete -c cybex -n '__cybex_using_subcommand theme export' -a 'CURRENT\tCurrent\ appearance (__cybex_themes)'
complete -c cybex -n '__cybex_using_subcommand theme remove' -a '(__cybex_themes)'
complete -c cybex -n '__cybex_using_subcommand theme install' -F

# cybex plugin
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a list -d 'List installed plugins'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a add -d 'Install a plugin from Git'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a update -d 'Update an installed plugin'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a remove -d 'Remove a plugin'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a enable -d 'Enable a plugin'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a disable -d 'Disable a plugin'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a set -d 'Change a plugin setting'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a clone -d 'Clone a plugin to customize it'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a bar -d 'Choose a bar plugin or native'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a reload -d 'Rescan plugins in the shell'
complete -c cybex -n '__cybex_using_subcommand plugin; and test (__cybex_arg_count) -eq 1' -a restart -d 'Restart the desktop shell'
complete -c cybex -n '__cybex_using_subcommand plugin enable' -a '(__cybex_plugins)'
complete -c cybex -n '__cybex_using_subcommand plugin disable' -a '(__cybex_plugins)'
complete -c cybex -n '__cybex_using_subcommand plugin update' -a '(__cybex_plugins)'
complete -c cybex -n '__cybex_using_subcommand plugin remove' -a '(__cybex_plugins)'
complete -c cybex -n '__cybex_using_subcommand plugin set' -a '(__cybex_plugins)'

# cybex shell
complete -c cybex -n '__cybex_using_subcommand shell; and test (__cybex_arg_count) -eq 1' -a status -d 'Show desktop shell health'
complete -c cybex -n '__cybex_using_subcommand shell; and test (__cybex_arg_count) -eq 1' -a safe -d 'Restart shell in safe mode'
complete -c cybex -n '__cybex_using_subcommand shell; and test (__cybex_arg_count) -eq 1' -a recover -d 'Leave safe mode and restart full shell'

# cybex backup
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a status -d 'Show last and next backup'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a now -d 'Back up now'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a snapshots -d 'List saved backups'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a restore -d 'Restore files into ~/Restored'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a setup -d 'Choose where backups go'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a automatic -d 'Turn daily backups on or off'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a recovery-key -d 'Replace the recovery key'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a confirm-key -d 'Confirm you saved the recovery key'
complete -c cybex -n '__cybex_using_subcommand backup; and test (__cybex_arg_count) -eq 1' -a excludes -d 'List excluded folders'
complete -c cybex -n '__cybex_using_subcommand backup setup; and test (__cybex_arg_count) -eq 2' -a 'local sftp'
complete -c cybex -n '__cybex_using_subcommand backup automatic' -a 'on off'

# cybex agent & assistant & ask
complete -c cybex -n '__cybex_using_subcommand agent; and test (__cybex_arg_count) -eq 1' -a get -d 'Show default coding agent'
complete -c cybex -n '__cybex_using_subcommand agent; and test (__cybex_arg_count) -eq 1' -a set -d 'Choose default coding agent'
complete -c cybex -n '__cybex_using_subcommand agent; and test (__cybex_arg_count) -eq 1' -a unset -d 'Clear default coding agent'
complete -c cybex -n '__cybex_using_subcommand agent; and test (__cybex_arg_count) -eq 1' -a list -d 'List supported coding agents'
complete -c cybex -n '__cybex_using_subcommand agent; and test (__cybex_arg_count) -eq 1' -a prompt -d 'Send a prompt to the default agent'
complete -c cybex -n '__cybex_using_subcommand agent set' -a 'opencode claude codex'
complete -c cybex -n '__cybex_using_subcommand ask' -l agent -xa 'auto claude codex' -d 'Choose assistant agent'
complete -c cybex -n '__cybex_using_subcommand assistant; and test (__cybex_arg_count) -eq 1' -a ask -d 'Ask Wiz a question'
complete -c cybex -n '__cybex_using_subcommand assistant; and test (__cybex_arg_count) -eq 1' -a status -d 'Show assistant status'
complete -c cybex -n '__cybex_using_subcommand assistant; and test (__cybex_arg_count) -eq 1' -a show -d 'Show Wiz'
complete -c cybex -n '__cybex_using_subcommand assistant; and test (__cybex_arg_count) -eq 1' -a hide -d 'Hide Wiz'
complete -c cybex -n '__cybex_using_subcommand assistant; and test (__cybex_arg_count) -eq 1' -a toggle -d 'Toggle Wiz'
