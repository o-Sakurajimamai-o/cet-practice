# 六级研习室 · CET6 Practice

Windows 本地六级练习工具。下载便携版后，无需安装 Python 或 Node.js；题目、答案、解析、音频和练习记录均在本机使用。

## 普通用户下载

进入 [Releases](https://github.com/o-Sakurajimamai-o/cet6-practice/releases)，下载 `CET6-Practice-v1.0.0-Windows-x64.zip`，完整解压到自己可写入的文件夹，再双击 `CET6-Practice.exe`。不要在压缩包内直接运行，不要只复制 EXE。

程序会自动打开浏览器。保留服务窗口；停止时双击 `Stop.bat`，或在服务窗口按 Ctrl+C。端口被其他软件使用时会选择空闲端口，不会结束其他软件。重复启动同一份程序会打开已有实例。

当前程序未做代码签名，可使用同版本 `SHA256SUMS.txt` 核对下载文件。

标准包包含 76 套、3467 题，其中 3315 道客观题，以及现有的 49 套听力音频。其余套次的源材料本身不带听力，页面会提示。作文和翻译供练习、参考，不自动评分。

## 可选原 PDF

题干、答案和解析已存入数据库，标准包正常使用不依赖原 PDF。需要对照原卷时，再下载 `CET6-Practice-v1.0.0-Optional-PDF.zip`，将其中 `CET6-Practice/resources` 合并到程序目录的 `resources`。未安装时，原 PDF 链接会显示安装说明。

`settings.json` 中的 `resource_directory` 可以是相对程序目录的路径，也可以是其他磁盘上的绝对目录；其下需保留资源原有的年份、套次、题型结构。修改后停止并重新启动程序。

## 数据与更新

首次启动从 `_internal/seed/cet6.db` 建立 `data/cet6.db`，以后不会用初始库覆盖已有数据。自己的作答、错题、收藏和笔记保存在 `data` 中。网站内“备份与恢复”可导出个人记录；复制整个数据库前请先正常停止程序。

更新前先导出备份。替换程序文件时保留自己的 `data` 文件夹。题库内容更新需要配套迁移，单纯更新 EXE 不会替换已有题库。不要把自己使用后的 `data` 发给其他人；给朋友分享原始 Release 压缩包。

## 题库边界

题库包含经过修正的参考答案与解析，仍保留 8 条材料来源或争议说明。2015 年听力为后期重排/改编材料；2026-06 第 2 套听力第 24 题保留参考答案 D，存在 C/D 近义争议。它是个人练习工具，不提供官方正确性认证。判分结果是客观题练习正确率，不是六级考试成绩。

## 从源码运行与构建

源码仓库不存放个人数据库、完整题库、音频、PDF、虚拟环境或前端依赖。需要先从 Release 解压 `seed`（便携包位于 `_internal/seed`）和 `resources`，放到仓库根目录的同名文件夹。

开发环境：Windows x64、Python 3.12、Node.js 18+（本次使用 Node 24）。

```powershell
python -m venv backend/venv
backend/venv/Scripts/python.exe -m pip install -r backend/requirements-runtime.txt
cd frontend
npm ci
npm run build
cd ..
backend/venv/Scripts/python.exe packaging/launcher.py
```

构建便携版：安装 `packaging/requirements-build.txt`，准备好 `seed` 和 `resources`，运行 `python packaging/build_windows.py`。构建输出为 `dist/CET6-Practice`。请使用新的虚拟环境构建，并在发布前验证无个人记录。

PDF 导入器仅供维护题库使用，额外依赖在 `backend/requirements.txt`。其资源根目录通过 `CET6_RESOURCE_ROOT` 指定；不要把重新导入当作验证答案正确性的依据。

第三方许可见 `THIRD_PARTY_NOTICES.md` 与 `third_party_licenses/`。源码、第三方依赖和考试材料各自的权利范围分别适用，公开仓库不为所有材料额外授予统一许可证。
