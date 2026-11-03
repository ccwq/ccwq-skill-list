# Anime.js：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

浏览器 JavaScript 与可访问的 DOM/SVG。输入元素或对象属性，输出实时动画状态。先核对主版本；此处按当前模块化文档组织。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 属性动画 | animate；Animation 文档 | 卡片位移、透明度、颜色或对象数值插值 |
| 编排与错峰 | createTimeline、stagger | 标题先入场，再逐个显示列表项 |
| 可拖拽与追随 | Draggable、Animatable 章节 | 制作可拖动的展示卡和鼠标追随反馈 |
| 滚动控制 | onScroll；Events 章节 | 滚动进入时触发标题，或同步推进时间线 |
| 矢量动作 | SVG toolset | 路径描边、沿路径移动及形状变化；先检查 SVG 结构 |
| 文字动画 | Text 章节 | 按字、词或行拆解标题后编排出现 |
| 布局与作用域 | Layout、Scope 章节 | 组件布局变化时过渡，并在卸载时清理作用域 |
| 缓动与执行引擎 | Easings、WAAPI、Engine | 同一动作比较弹簧、线性与缓入缓出的节奏 |

## 最小实现路径

安装 animejs → 挂载后找到目标 → 建立动画或时间线 → 绑定触发 → 在卸载时清理。

## 展开用例：三张卡片依次入场

输入三个已挂载元素；输出一次错峰位移和淡入。

animate 配 opacity/translateY → stagger 配 delay → 交互事件启动 → 路由卸载取消实例。

关键参数与验收：先调位移、duration、stagger 间隔和 ease；测试重复触发、反向导航和重新挂载。

## 边界与常见问题

v3 的 anime(...) 与当前模块化导入不能混抄。滚动触发和滚动同步分开选。涉及布局、文字重排时在真实页面测量；视频输出另定捕获路线。

## 验证

重复触发、路由切换及窗口变化后动作正常，组件卸载后无残留动画。

## 官方入口

- https://animejs.com/documentation/
- https://animejs.com/documentation/timeline/
- https://animejs.com/documentation/events/onscroll/
