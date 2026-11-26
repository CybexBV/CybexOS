"""The fake firmware device of nix/tests/firmware.nix, also run by its unit test.

It stands in for `cybexos-firmware-update`: `plan` lists one device until it is
installed, `install` streams libfwupd-style events on stderr as the real helper
does. No firmware is flashed.

After its progress and its request to keep power connected, the device holds
its write until the test creates the `continue` file. The worker publishes a
status for each event, so what a reader sees mid-write stays put until the test
has looked at it, instead of for a fixed time that a slow machine can overrun.

QUALIFICATION_FIRMWARE_STATE (default /var/lib/cybexos) holds both files;
QUALIFICATION_FIRMWARE_HOLD_SECONDS bounds the hold.
"""
import json
import os
import pathlib
import sys
import time

DEVICE = {'id': 'qualification-bios', 'name': 'System Firmware', 'vendor': 'Qualification',
          'from': '1', 'to': '2', 'needsReboot': True, 'needsShutdown': False, 'affectsFde': True}
STATE = pathlib.Path(os.environ.get('QUALIFICATION_FIRMWARE_STATE', '/var/lib/cybexos'))
INSTALLED = STATE / 'qualification-firmware-installed'
CONTINUE = STATE / 'qualification-firmware-continue'
HOLD_SECONDS = float(os.environ.get('QUALIFICATION_FIRMWARE_HOLD_SECONDS', '600'))


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}), file=sys.stderr, flush=True)


def install(plan):
    expected = json.loads(pathlib.Path(plan).read_text())
    assert expected == {'devices': [DEVICE]}, expected
    emit('device', id=DEVICE['id'])
    emit('progress', id=DEVICE['id'], percent=42, status='device-write')
    emit('request', id=DEVICE['id'], kind='immediate', message='Keep external power connected.')
    deadline = time.monotonic() + HOLD_SECONDS
    while not CONTINUE.exists():
        if time.monotonic() > deadline:
            emit('failed', id=DEVICE['id'], message='The test never released the device write.')
            emit('summary', installed=0, failed=1, needsReboot=False, needsShutdown=False)
            return 1
        time.sleep(0.1)
    INSTALLED.touch()
    emit('installed', id=DEVICE['id'], needsReboot=True)
    emit('request', id=DEVICE['id'], kind='post', message='Restart to finish.')
    emit('summary', installed=1, failed=0, needsReboot=True, needsShutdown=False)
    return 0


def main(arguments):
    if arguments[:1] == ['plan']:
        print(json.dumps({'devices': [] if INSTALLED.exists() else [DEVICE]}))
        return 0
    if arguments[:1] == ['install']:
        return install(arguments[arguments.index('--plan') + 1])
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
