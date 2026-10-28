# 四六级研习室 · CET Practice

Windows / macOS 本地四六级练习工具，题目、解析、听力和练习记录都在本机使用。

感谢 [Linux Do 社区](https://linux.do/)。

## 下载使用

进入 [Releases](https://github.com/o-Sakurajimamai-o/cet-practice/releases/latest)，按系统下载，无需安装 Python 或 Node.js：

- **Windows**：下载 `Windows-x64.zip`，解压后双击 `CET-Practice.exe`；停止时运行 `Stop.bat`。
- **macOS 14+**：M 系列芯片下载 `macOS-arm64.zip`，Intel 芯片下载 `macOS-x86_64.zip`，解压后将 `.app` 拖到「应用程序」打开。首次打开提示及退出方式见 [Mac 使用说明](docs/MACOS.md)。

包含四级 2020—2026 年 46 套、六级 2015—2026 年 76 套，共 6,089 题；含现有 76 份独立听力。部分四级套次按来源标注共用材料。支持作答保存、错题、收藏、笔记和句子精讲。

支持题型切换、题号导航、阅读分段和听力分组。复习空间可统计、搜索及导出标记的单词和句子；仔细阅读交卷后可按自然段切换中英对照。

Windows 旧版请解压到新目录，再用「备份与恢复」迁移记录。Windows 数据在程序旁的 `data`；Mac 数据在 `~/Library/Application Support/CET-Practice/data`。分享时请发送原始发布压缩包。

## 可选原 PDF

需要原卷时下载 [v1.1.0 的 Optional-PDF 补充包](https://github.com/o-Sakurajimamai-o/cet-practice/releases/tag/v1.1.0)。Windows 将 `resources` 合并到程序目录；Mac 从菜单栏「四六级 → 选择原 PDF 文件夹」选择解压目录。日常刷题无需此包。

题库使用第三方参考答案，来源分歧保留在「题库报告」中；练习正确率不是四六级考试成绩。

源码运行与打包见 [构建说明](docs/BUILD.md)。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
