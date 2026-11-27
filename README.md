# 投个好稿 · Dear Editor · まだ査読中

**1.0 · 科研投稿管理工具**

**日常使用（Windows）：[下载 ZIP](https://github.com/Huaisong-Yang/dear-editor/archive/refs/heads/main.zip)，解压后双击 `DearEditor.cmd`。**

## 在线体验

**[打开测试网页 → huaisong-yang.github.io/dear-editor/](https://huaisong-yang.github.io/dear-editor/)**

这是静态演示版。全新浏览器环境可用 **`admin` / `password`** 体验。改动只保存在当前浏览器，清除网站数据后可能丢失；它不会连接你的本地数据库，也不会影响其他访问者。

## 功能

- 投稿流程、审稿轮次、返修和录用记录。
- 作者库、期刊库、机构地址与复制导出。
- 引用统计、个人学术主页。
- 本地多账号、作息进度、倒计时与待办事项。
- 昼夜模式、备份恢复及15秒操作撤回。

## Windows 本地使用

1. 安装 Python 3，确保 `py` 或 `python` 命令可用。不需要安装额外的 Python 包。
2. 下载并解压完整 ZIP，双击 **`DearEditor.cmd`**，不要直接打开 `index.html`。
3. 在自动打开的 `http://127.0.0.1:8765` 注册或登录。本地版不预置演示账号。关闭最后一个本地版标签页后，启动器通常约 2 秒自动退出；正在写入时会先等保存完成。若浏览器未发出关闭通知，则会在超时后退出。

每次成功保存都写入 `%LOCALAPPDATA%\DearEditor\workspace.sqlite3`。清除 Cookie 或网站数据后，重新登录原账号即可找回记录，不必每天导出。服务仅在本机监听；数据库中的稿件内容未加密，也不会自动上传。换电脑或防范磁盘故障时，仍建议导出备份。

旧网页或直接打开 HTML 时保存的资料，可以从「备份与设置」导入现有 JSON 一次。导入不会替换当前本地账号的用户名和密码。

### 桌面作息进度浮窗

Windows 本地版登录后默认显示桌面浮窗。在「组件与作息」用滑块开关，立即生效，不用点保存。浮窗只显示当前阶段、剩余时间和进度，沿用网页的时段配色；休息时显示上班倒计时。拖到屏幕左侧或右侧会收成只显示进度的半透明圆角方块；停留片刻或点击可恢复。点击普通卡片可查看全部倒计时和待办事项，列表较长时可滚动。点浮窗的关闭按钮会同步关闭开关；关闭最后一个本地版标签页后浮窗随启动器退出，下次仍按保存的开关状态启动。

浮窗使用 Python 自带的 Tkinter（安装 Python 时可选 Tcl/Tk 支持）。不安装它仍可正常使用其他功能。GitHub Pages 不提供桌面浮窗。

## 更新投稿进展

- 未录用稿件可用「更新进展」修改阶段、输入评审总数或开启新一轮。已录用稿件的入口是「更新引用数」。
- 从稿件详情或「一键查询」打开 Elsevier，保留原来的 Dear Editor 标签页，手动提交并完成人机验证。结果只按稿件号核对，更改标题不影响回传，也不会覆盖本地标题。无变化只提示，不写入；有变化可点「确认并返回」，核对预填差异后再保存。无法核对稿件号或识别结果时可手动更新。
- 只有 Under Review 会读取页面提供的评审人数。With Editor、Required Reviews Complete 和 Complete 不需要人数即可核对；原有计数不会清空。Complete 表示「已完成，结果待确认」，请以期刊决定信为准。

### 配置浏览器查询助手

1. [下载完整 ZIP](https://github.com/Huaisong-Yang/dear-editor/archive/refs/heads/main.zip) 并解压。打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`。
2. 启用「开发者模式」，点击「加载解压缩的扩展」，选中解压目录中的 **`integrations/elsevier`**（其中有 `manifest.json`），不要选项目根目录。
3. 确认 **Dear Editor · 查询助手** 已启用，并允许扩展访问正在使用的 Dear Editor 地址（Windows 本地版为 `127.0.0.1`）。从旧版本更新时，在扩展管理页点「重新加载」，刷新 Dear Editor，再发起新查询。

这是唯一支持的自动查询助手安装方式。不安装扩展仍可手动查询和更新。

### 从 Scopus 更新引用

在学术主页填写并保存 Scopus Author ID。从学术主页的「更新自 Scopus」或已录用稿件的「更新引用数」打开作者页。保留发起查询的 Dear Editor 标签页；文献列表加载后点击「读取数据并返回」，扩展会切回原来的标签页，不会新开一个 Dear Editor 页面。Elsevier 稿件查询也使用相同的返回方式。若网页有分页，可切到需要的列表再读取，不会自动遍历。

「学术指标」显示文献数、引用次数和 h-index。确认页列出匹配的论文、当前数值及读取值，可逐篇选择是否更新。论文优先按 DOI 核对；无法按 DOI 核对时用唯一标题匹配。页面没有显示的引用数不会被填成 0。

## 文件

- `app.js` / `app.css` / `progress.js`：应用脚本、样式及进展更新，保留旧数据迁移兼容逻辑。
- `DearEditor.cmd`、`local_server.py`、`local-mode.js`、`local-memory.js`、`desktop_widget.py`：Windows 启动、本地数据库及可选桌面浮窗。
- `accounts.js`：本地账号存储隔离。
- `languages.js`：语言与方言文案。
- `vendor/`：OpenCC 及其许可证。
- `integrations/elsevier/`：可选浏览器查询扩展（Elsevier 和 Scopus）。

图片作者识别使用外部 Tesseract 资源，首次使用需联网；识别结果须人工核对。
引用记录为手动输入或用户确认的平台快照，不是实时数据。

## 反馈

yanghuaisong@hrbeu.edu.cn
