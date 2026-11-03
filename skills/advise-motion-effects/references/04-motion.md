# Motion：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

先区分原生 JS、React 和 Vue。JS 用 motion，React 通常用 motion/react，当前 Vue 文档使用 motion-v；以项目锁定版本为准。输入界面状态、手势或滚动值，输出元素动画。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 基本属性与序列 | JS animate；React/Vue motion 组件 | 状态变化时使面板淡入并移动 |
| 挂载与退出 | AnimatePresence、initial/animate/exit | 关闭弹窗后先播放退出动作，再移除元素 |
| 布局与共享过渡 | layout、layoutId、LayoutGroup | 卡片展开成详情页，列表重排平滑过渡 |
| 手势 | whileHover、拖动与按压章节 | 悬停提起按钮，拖动卡片并限制边界 |
| 滚动动作 | JS scroll/inView；useScroll/useInView | 分别制作阅读进度条与进入视口时的出现动画 |
| 运动值与弹簧 | useMotionValue、useTransform、useSpring | 把滚动进度映射到缩放，再用弹簧平滑 |
| 手动编排与无障碍 | useAnimate、useReducedMotion、MotionConfig | 按事件顺序播放动作，并提供减少动态效果版本 |

## 最小实现路径

确定框架与包 → 选声明式组件或 JS API → 绑定状态/滚动 → 配退出和卸载 → 检查交互。

## 展开用例：Vue 弹窗退出与布局过渡

输入弹窗显示状态；输出有进出场动画的界面。

从 motion-v 文档确定组件 → AnimatePresence 管理退出 → motion 节点定义 initial/animate/exit → 需要尺寸移动时加 layout。

关键参数与验收：先调 opacity、y 与 transition；快速开关弹窗，检查唯一 key 和退出结束前的节点保留。

## 边界与常见问题

三个框架的导入和生命周期不同；高级组件的授权/可用性单独检查。不为简单淡入同时引入 Anime.js 与 Motion。

## 验证

反复开关、快速切换状态时没有遗留节点；减少动态效果偏好生效。

## 官方入口

- https://motion.dev/docs/animate
- https://motion.dev/docs/react
- https://motion.dev/docs/vue
