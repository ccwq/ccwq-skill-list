# Manim Community：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

Python 与该版本需要的系统依赖。普通文字依赖字体；Tex/MathTex 路线通常需要 LaTeX。输入数学对象和脚本，输出讲解动画。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 基本图形与布局 | Scene、Mobject、VGroup | 排出三组几何对象并添加注释 |
| 文字与公式 | Text、Tex、MathTex | 显示中文标题及数学表达式，按子项强调 |
| 生成与形变 | Create、Write、Transform、ReplacementTransform | 圆形转为方形，逐步展示推导步骤 |
| 图表与坐标 | Axes、NumberPlane、plot、坐标转换 | 绘制曲线并标记某点的坐标 |
| 参数联动 | ValueTracker、always_redraw、add_updater | 移动参数时同步更新切线与标签 |
| 时序与强调 | AnimationGroup、LaggedStart、Succession、Indicate | 对象错峰出现，再强调结论 |
| 三维与镜头 | ThreeDScene、MovingCameraScene | 旋转三维坐标系或放大局部公式 |
| 渲染规格 | CLI、config | 低质量预览后按交付尺寸渲染 |

## 最小实现路径

创建 Scene 子类 → construct 内定义对象 → self.play 编排 → 低质量渲染 → 核对字体/公式后提高质量。

## 展开用例：参数变化时曲线与标签联动

输入函数与参数范围；输出一段数学演示。

Axes 定坐标 → ValueTracker 存参数 → always_redraw 或 updater 计算曲线/标签 → self.play 驱动 tracker.animate → 渲染预览。

关键参数与验收：先调参数范围、run_time、坐标范围和标签位置；检查标签对应实际曲线而非静态初值。

## 边界与常见问题

使用 Community 文档，不混用 ManimGL。对象形变须关注子对象匹配；物理和科研数值计算另行求解后提供数据。

## 验证

公式没有缺字，联动对象逐帧一致，旁白与动作时长匹配。

## 官方入口

- https://docs.manim.community/en/stable/reference.html
- https://docs.manim.community/en/stable/examples.html
