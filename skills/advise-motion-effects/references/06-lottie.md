# Lottie Web：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

已有的兼容动画 JSON、外部图片/字体及网页容器。输入设计工具导出数据，输出网页播放；不承担通用动画建模。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 载入与渲染 | loadAnimation；svg/canvas/html renderer | 将完成态图标的 JSON 加载到按钮旁 |
| 播放控制 | play、pause、stop、setSpeed、setDirection | 悬停播放，离开暂停；按业务状态反向播放 |
| 定位进度 | goToAndStop、goToAndPlay | get scroll progress 后映射到目标帧 |
| 片段控制 | playSegments | 把同一动画的加载段和成功段分别播放 |
| 事件与销毁 | DOMLoaded、complete、destroy | 加载完成后允许交互，组件卸载时清理 |
| 文字更新与资源 | updateDocumentData、图片和字体加载 | 替换已支持文字层的文案；检查实际导出结构 |
| 兼容性评估 | Supported Features / renderer 文档 | 逐项检查遮罩、效果、字体和设计素材的实际表现 |

## 最小实现路径

获得实际 JSON → 放置有尺寸容器 → loadAnimation → 等加载事件 → 绑定业务状态并清理实例。

## 展开用例：加载后播放成功段

输入真实 JSON 与成功段帧范围；输出业务完成反馈。

loadAnimation 关闭 autoplay → 等 DOMLoaded → 完成事件调用 playSegments → 完成后保持末态或按业务切换 → 卸载 destroy。

关键参数与验收：先调片段区间、loop、speed；检查图片和字体，素材帧数不足时不沿用示例范围。

## 边界与常见问题

isFrame 参数明确区分帧和时间。不同 renderer 支持不同；不能保证所有 AE 效果可还原。滚动联动由工程额外建立。

## 验证

对照原素材检查关键帧、图片、字体；多次挂载不重复播放。

## 官方入口

- https://github.com/airbnb/lottie-web
- https://github.com/airbnb/lottie-web/wiki
