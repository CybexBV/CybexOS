"""Asks xdg-desktop-portal for an Open dialog and waits for the answer, as an app does.

Prints the response code (0 chosen, 1 cancelled, 2 other) and the chosen URIs.
"""
import sys

from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION)
sender = bus.get_unique_name()[1:].replace('.', '_')
token = 'cybexos_test'
path = f'/org/freedesktop/portal/desktop/request/{sender}/{token}'
loop = GLib.MainLoop()
result = {}


def answered(_connection, _sender, _path, _interface, _signal, parameters):
    code, results = parameters.unpack()
    result.update(code=code, uris=results.get('uris', []))
    loop.quit()


bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request', 'Response', path,
                     None, Gio.DBusSignalFlags.NO_MATCH_RULE, answered)
bus.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
              'org.freedesktop.portal.FileChooser', 'OpenFile',
              GLib.Variant('(ssa{sv})', ('', sys.argv[1] if len(sys.argv) > 1 else 'Open a file',
                                         {'handle_token': GLib.Variant('s', token)})),
              None, Gio.DBusCallFlags.NONE, -1, None)
GLib.timeout_add_seconds(300, loop.quit)
loop.run()
print(result.get('code', 'timeout'), ' '.join(result.get('uris', [])))
