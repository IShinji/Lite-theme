# Lite-Theme

Lite 官方公共大屏主题，版本 `V1.2.2`。

主题使用与 Lite 管理后台一致的视觉语言，提供服务器概览、服务器详情和网络延迟展示。电脑端按宽度排成 1 至 4 列卡片，移动端自动切换为单列。

## 功能

- 首页展示服务器状态、资源占用、实时上下行、流量配额、账单剩余天数，以及最多 4 条探测的网络质量。
- 详情页展示资源用量、流量统计和历史趋势。
- 网络页可点选一条或多条探测任务看曲线。
- 支持简体中文、繁体中文、英语和日语。
- 支持浅色、深色和跟随系统外观。

## 安装及更新

在 Lite 后台「主题管理」上传 GitHub Release 中的 zip，或填写本仓库地址后从原 URL 更新。
已安装主题的，点击主题卡片后点击「更新主题」。

## 开发

```bash
npm install
npm run dev
```

构建与测试：

```bash
npm run test
npm run build
```

构建产物位于 `dist`。主题识别文件见 `Lite-theme.json`。仓库：https://github.com/nuomiiiii/Lite-theme

## 许可

本主题随 Lite 项目分发，许可信息见 `LICENSE`。
