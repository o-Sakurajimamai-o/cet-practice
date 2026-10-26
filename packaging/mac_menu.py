"""Small native menu; the practice interface remains in the user's browser."""
import json
import signal
import threading
from pathlib import Path

from AppKit import (NSApplication, NSApplicationActivationPolicyAccessory, NSMenu,
                    NSMenuItem, NSObject, NSOpenPanel, NSStatusBar, NSVariableStatusItemLength,
                    NSWorkspace, NSTerminateLater, NSEvent, NSApplicationDefined)
from Foundation import NSURL
from PyObjCTools import AppHelper


def run_menu(server, sock, port, user_root, settings_path, settings):
    application = NSApplication.sharedApplication()
    application.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    url = f'http://127.0.0.1:{port}/'
    errors = []
    pending_termination = False

    class PracticeMenu(NSObject):
        def openPractice_(self, sender):
            NSWorkspace.sharedWorkspace().openURL_(NSURL.URLWithString_(url))

        def openData_(self, sender):
            NSWorkspace.sharedWorkspace().openFile_(str(user_root))

        def choosePDF_(self, sender):
            panel = NSOpenPanel.openPanel()
            panel.setTitle_('选择解压后的 PDF 补充包或 resources 文件夹')
            panel.setCanChooseFiles_(False)
            panel.setCanChooseDirectories_(True)
            panel.setAllowsMultipleSelection_(False)
            application.activateIgnoringOtherApps_(True)
            if panel.runModal() != 1:
                return
            selected = Path(panel.URL().path())
            if (selected / 'resources').is_dir():
                selected = selected / 'resources'
            settings['pdf_resource_directory'] = str(selected)
            temporary = settings_path.with_suffix('.tmp')
            temporary.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding='utf-8')
            temporary.replace(settings_path)
            from app import main as api
            api.PDF_ROOT = selected

        def quitPractice_(self, sender):
            server.should_exit = True
            self.quit_item.setTitle_('正在保存并退出…')
            self.quit_item.setEnabled_(False)

        def applicationShouldTerminate_(self, sender):
            nonlocal pending_termination
            pending_termination = True
            self.quitPractice_(None)
            return NSTerminateLater  # Reply only after server and database cleanup.

        def applicationShouldHandleReopen_hasVisibleWindows_(self, sender, visible):
            self.openPractice_(None)
            return False

    controller = PracticeMenu.alloc().init()
    application.setDelegate_(controller)
    status = NSStatusBar.systemStatusBar().statusItemWithLength_(NSVariableStatusItemLength)
    status.button().setTitle_('四六级')
    menu = NSMenu.alloc().init()
    for title, action in [('打开练习网页', 'openPractice:'), ('打开数据目录', 'openData:'),
                          ('选择原 PDF 文件夹…', 'choosePDF:'), ('退出四六级研习室', 'quitPractice:')]:
        item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(title, action, '')
        item.setTarget_(controller)
        menu.addItem_(item)
        if action == 'quitPractice:':
            controller.quit_item = item
    status.setMenu_(menu)

    def serve():
        try:
            server.run(sockets=[sock])
        except BaseException as error:
            errors.append(error)
    worker = threading.Thread(target=serve, name='cet-local-server')
    worker.start()
    opened = False

    def poll():
        nonlocal opened
        if not worker.is_alive():
            # AppHelper.stopEventLoop sends terminate:, which would re-enter our
            # asynchronous quit delegate. Stop NSApplication.run directly instead.
            application.stop_(None)
            event = NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
                NSApplicationDefined, (0, 0), 0, 0, 0, None, 0, 0, 0)
            application.postEvent_atStart_(event, True)
            return
        if server.started and not opened:
            opened = True
            controller.openPractice_(None)
        AppHelper.callLater(.2, poll)

    AppHelper.callLater(.2, poll)
    old_handlers = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
    def request_quit(number, frame):
        server.should_exit = True
    for number in old_handlers:
        signal.signal(number, request_quit)
    try:
        application.run()
    finally:
        server.should_exit = True
        worker.join(timeout=20)
        NSStatusBar.systemStatusBar().removeStatusItem_(status)
        for number, handler in old_handlers.items():
            signal.signal(number, handler)
    if worker.is_alive():
        raise RuntimeError('Local server did not stop in time.')
    if errors:
        raise errors[0]
    return application if pending_termination else None
