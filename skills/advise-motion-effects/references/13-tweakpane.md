# Tweakpane：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

网页参数对象与界面。输入可绑定值或监控值，输出调参事件和可导出的面板状态；不负责渲染。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 基础参数 | Pane、addBinding | 滑块调整发光强度，颜色控件修改材质颜色 |
| 值约束 | bindings 的 min/max/step/options | 限制粒子寿命范围，并选择效果预设 |
| 组织与动作 | addFolder、addTab、addButton | 按镜头/灯光/粒子分类，按钮重播爆发 |
| 只读监控 | addBinding 的 readonly/view/interval | 显示自采集的帧耗时曲线 |
| 事件同步 | on(change)、refresh | 参数变化后更新场景；外部改变后刷新面板 |
| 状态保存 | exportState、importState | 保存面板状态，重新加载后恢复 |
| 主题与扩展 | themes、plugins、blades | 增加自定义参数控件 |

## 最小实现路径

建立参数对象 → 添加绑定 → change 时更新工程状态 → 保存场景配置及必要面板状态 → 重载验证。

## 展开用例：保存镜头与发光预设

输入普通参数对象；输出可复用 JSON。

addFolder 分类 → addBinding 配 min/max/step → change 更新场景 → 保存实际参数 JSON → 重开时读取并应用 → 必要时导入面板状态。

关键参数与验收：先确定哪些值属于工程数据、哪些属于界面状态；刷新后画面和面板都必须一致。

## 边界与常见问题

v4 使用 ESM；不要混抄旧 addInput/addMonitor API。面板状态与完整场景配置不同；写入磁盘或本地存储须额外实现。

## 验证

滑块值确实改变画面；外部值同步；重启后工程参数可复现。

## 官方入口

- https://tweakpane.github.io/docs/
- https://tweakpane.github.io/docs/quick-tour/
- https://tweakpane.github.io/docs/misc/
