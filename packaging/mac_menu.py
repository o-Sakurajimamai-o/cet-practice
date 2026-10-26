"""Small native menu; the practice interface remains in the user's browser."""
import json
import threading
import webbrowser
from pathlib import Path

from AppKit import (NSApplication, NSApplicationActivationPolicyAccessory, NSMenu,
                    NSMenuItem, NSObject, NSOpenPanel, NSStatusBar, NSVariableStatusItemLength,
                    NSWorkspace, NSTerminateCancel)
from PyObjCTools import AppHelper


def run_menu(server, sock, port, user_root, settings_path, settings):
    application = NSApplication.sharedApplication()
    application.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    url = f'http://127.0.0.1:{port}/'
    errors = []

    class PracticeMenu(NSObject):
        def openPractice_(self, sender):
            webbrowser.open(url)

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
            self.quitPractice_(None)
            return NSTerminateCancel  # Stop only after Uvicorn finishes pending requests.

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
            AppHelper.stopEventLoop()
            return
        if server.started and not opened:
            opened = True
            webbrowser.open(url)
        AppHelper.callLater(.2, poll)

    AppHelper.callLater(.2, poll)
    try:
        AppHelper.runEventLoop(installInterrupt=True)
    finally:
        server.should_exit = True
        worker.join(timeout=20)
        NSStatusBar.systemStatusBar().removeStatusItem_(status)
    if worker.is_alive():
        raise RuntimeError('Local server did not stop in time.')
    if errors:
        raise errors[0]
