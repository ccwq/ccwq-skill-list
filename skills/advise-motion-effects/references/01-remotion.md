# Remotion：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

React 视频工程；Node、匹配版本的 Remotion 包及渲染所需浏览器。输入组件、数据和素材，输出逐帧画面、视频或静帧。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 合成与布局 | Composition、AbsoluteFill、useVideoConfig | 定义 1920×1080、30 fps 的产品介绍合成 |
| 逐帧动画 | useCurrentFrame、interpolate、spring | 标题在前 20 帧淡入，图表柱随帧数增长 |
| 镜头编排 | Sequence、Series、Loop、Freeze | 片头后接三段内容，暂停在公式结果帧 |
| 媒体与声音 | Img、OffthreadVideo、@remotion/media | 把演示视频、旁白和叠加标题放到同一时间轴 |
| 转场与字幕 | @remotion/transitions、@remotion/captions | 镜头滑动交接，按词时间戳突出当前词 |
| 数据驱动与交互预览 | getInputProps、@remotion/player | 同一模板按不同实验数据生成多条视频 |
| 渲染与部署 | CLI render/still、@remotion/renderer、Lambda/Cloud Run 文档 | 本地先导出 3 秒样片，再决定是否批量云渲染 |

## 最小实现路径

定义合成及总帧数 → 写帧函数 → 用 Sequence 编排 → 预览首中尾帧 → 渲染短片。

## 展开用例：4 秒数据标题片

输入标题和一个数值；输出 120 帧、30 fps 的视频。

定义 Composition 的 width/height/fps/durationInFrames → props 传入文案 → useCurrentFrame 与 interpolate 计算数值 → Sequence 安排标题和结论 → CLI 渲染。

关键参数与验收：先调入场帧区间、字号和镜头区间。检查第 0、60、119 帧以及导出时长，不把秒直接填进帧参数。

## 边界与常见问题

所有动画由帧号决定；音频组件和媒体包按安装版本核对。字体、异步素材加载与随机数须可复现。网页定时器不能直接视作可靠的离线时间轴。商业许可单独核对。

## 验证

逐帧跳转时动画位置正确；导出后复核帧数、尺寸和声音同步。

## 官方入口

- https://www.remotion.dev/docs/api
- https://www.remotion.dev/docs/the-fundamentals
