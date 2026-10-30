# 英语研习室 · CET Practice

Windows / macOS 本地英语练习工具，支持四六级与考研英语。

感谢 [Linux Do 社区](https://linux.do/)。

## 下载使用

在 [Releases](https://github.com/o-Sakurajimamai-o/cet-practice/releases/latest) 选择系统及版本，无需安装 Python 或 Node.js：

- Windows 选择 `Windows-x64`；Mac M 系列选择 `macOS-arm64`，Intel 选择 `macOS-x86_64`（macOS 14 及以上）。
- `WithAudio` 附带四六级听力音频；`NoAudio` 不含音频，保留听力题目、原文和解析。
- Windows 解压后双击 `CET-Practice.exe`，使用 `Stop.bat` 退出。Mac 解压后将应用拖到「应用程序」，首次打开及退出方式见 [Mac 使用说明](docs/MACOS.md)。

包含四级 46 套、六级 76 套及考研英语 46 套，支持记录进度、错题、收藏、笔记、划词统计和阅读中英切换。考研整卷 PDF 从练习页链接下载。四六级原 PDF 可选下载 [v1.1.0 的 Optional-PDF 补充包](https://github.com/o-Sakurajimamai-o/cet-practice/releases/tag/v1.1.0)。

Windows 旧版请解压到新目录，再通过「备份与恢复」迁移记录。Mac 数据保存在 `~/Library/Application Support/CET-Practice/data`，替换应用前建议先备份。分享时请发送原始发布压缩包。

题库使用第三方参考答案，可能存在来源分歧；练习正确率不等于考试成绩。源码运行与打包见 [构建说明](docs/BUILD.md)，第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
