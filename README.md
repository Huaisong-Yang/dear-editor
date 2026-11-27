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
3. 在自动打开的 `http://127.0.0.1:8765` 注册或登录。本地版不预置演示账号。关闭最后一个本地版标签页后，启动器通常约 10 秒自动退出；若浏览器未发出关闭通知，则会在超时后退出。

每次成功保存都写入 `%LOCALAPPDATA%\DearEditor\workspace.sqlite3`。清除 Cookie 或网站数据后，重新登录原账号即可找回记录，不必每天导出。服务仅在本机监听；数据库中的稿件内容未加密，也不会自动上传。换电脑或防范磁盘故障时，仍建议导出备份。

旧网页或直接打开 HTML 时保存的资料，可以从「备份与设置」导入现有 JSON 一次。导入不会替换当前本地账号的用户名和密码。

## 更新投稿进展

- 稿件卡片和详情页都有「更新进展」：可修改阶段、记录本轮评审人数，或在返修后开启新一轮，不必打开完整编辑表单。
- 从稿件详情或「一键查询」打开 Elsevier，保留原来的 Dear Editor 标签页，手动提交并完成人机验证。结果只按稿件号核对，更改标题不影响回传，也不会覆盖本地标题。无变化只提示，不写入；有变化可点「确认并返回」，核对预填差异后再保存。无法核对稿件号或识别结果时可手动更新。
- 只有 Under Review 会读取页面提供的评审人数。With Editor、Required Reviews Complete 和 Complete 不需要人数即可核对；原有计数不会清空。Complete 表示「已完成，结果待确认」，请以期刊决定信为准。

### 配置 Elsevier 浏览器扩展

1. [下载完整 ZIP](https://github.com/Huaisong-Yang/dear-editor/archive/refs/heads/main.zip) 并解压。打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`。
2. 启用「开发者模式」，点击「加载解压缩的扩展」，选中解压目录中的 **`integrations/elsevier`**（其中有 `manifest.json`），不要选项目根目录。
3. 确认 **Dear Editor · Elsevier** 已启用，然后从 Dear Editor 重新打开查询。若以前配置过旧助手，请先移除或停用；以后更新同一安装目录时，在扩展管理页点「重新加载」即可。

这是唯一支持的自动查询助手安装方式。不安装扩展仍可手动查询和更新。

## 文件

- `app.js` / `app.css` / `progress.js`：应用脚本、样式及进展更新，保留旧数据迁移兼容逻辑。
- `DearEditor.cmd`、`local_server.py`、`local-mode.js`、`local-memory.js`：Windows 启动和本地数据库功能。
- `accounts.js`：本地账号存储隔离。
- `languages.js`：语言与方言文案。
- `vendor/`：OpenCC 及其许可证。
- `integrations/elsevier/`：可选 Elsevier 查询扩展。

图片作者识别使用外部 Tesseract 资源，首次使用需联网；识别结果须人工核对。
引用指标手动维护，不代表自动抓取的实时平台数据。

## 反馈

yanghuaisong@hrbeu.edu.cn
