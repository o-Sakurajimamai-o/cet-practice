# 四六级研习室 · macOS

适用于 macOS 14 或更高版本。Apple 芯片（M 系列）下载 `macOS-arm64.zip`；Intel 芯片下载 `macOS-x86_64.zip`。无需安装 Python 或 Node.js。

1. 完整解压，将 `CET-Practice.app` 拖到「应用程序」文件夹，然后双击打开。也可以保留整个解压文件夹并直接打开应用。
2. 浏览器自动打开练习网页；菜单栏会出现「四六级」，可重新打开网页、查看数据目录、选择原 PDF 文件夹或退出。
3. 退出请用菜单栏「四六级 → 退出四六级研习室」；关闭网页标签后服务仍在运行。压缩包内的 `停止.command` 可停止同目录的应用，也可停止已移到「应用程序」文件夹的同名应用。

此版本有本地临时签名，尚未经过 Apple 开发者签名和公证。首次被 macOS 拦截时，先确认下载自本项目的 GitHub Releases，再到「系统设置 → 隐私与安全性 → 仍要打开」。不需要关闭系统安全保护。

个人记录保存在 `~/Library/Application Support/CET-Practice/data`，日志和设置在其上级目录。升级时退出旧版，再替换应用，数据保留。Windows 记录可用网页的「备份与恢复」导入。

PDF 为可选补充包，可沿用 v1.1.0 的 `Optional-PDF.zip`。解压后从菜单栏「四六级 → 选择原 PDF 文件夹」选择补充包或其中的 `resources`。音频和题库已内置，离线刷题无需 PDF。

感谢 [Linux Do 社区](https://linux.do/)。
