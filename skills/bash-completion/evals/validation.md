# 首版离线验证记录

## 已执行

- Windows Git Bash 5.2：`bash -n` 语法通过；静态探针及 `--help` 正常。
- Bash POSIX 模式：静态探针通过。这不等于已在 dash/其他 Unix shell 实测。
- 参数错误：未知参数、`--help extra` 返回 2。
- 故障注入：测试用 sed 函数返回 19，探针传播 19，不输出 PROBE_COMPLETE。
- 启动隔离：系统临时 HOME 中设置会创建标记的 .bashrc；以 `--noprofile --norc` 启动探针后未出现标记，无新增 HOME 文件。
- 内部相对链接全部存在；evals.json 含三个情景；Git 能发现全部技能文件。
- 独立只读情景评审：未指定主机、自动建议与 Tab 区分、ble.sh 的 -c/PTY 限制，三项均符合预期。

评审发现的格式化失败未传播和多参数帮助绕过问题已修复并回归。

## 未执行

没有联网、连接远程、安装软件、加载真实用户启动配置或开展 PTY 按键验收。没有进行基线模型对比或触发率基准测试，情景通过仅指流程评审。测试临时 HOME 自动清理，未往项目 scripts 目录添加探针。

# 泛化优化版验证（2026-09-29）

## 文档与静态

- 独立只读策略评审：8/8情景符合期望，不等同模型触发率或生产功能通过。
- 明确安装身份/配置账号、手动sudo交接、安装三态与未知、包接口复用和官方兼容层。
- 内部链接有效；检查未固化本次账号、发行版实例、容器名称或代理端口。
- 主文仍为49行；按环境/身份/授权分支读取参考，不引入固定部署教程。
- Windows原生PTY返回结构化unsupported、exit 2，不自动连接WSL。
- 静态探针在授权WSL的sh下语法与帮助检查通过。

## 实验性PTY工具

最终 **20/20 离线unittest通过**（WSL Python标准库，约5秒）。测试位于本skill的 `evals/test_verify_pty.py`。可在Unix环境从skill目录运行：

```bash
python3 -B -m unittest discover -s evals -p test_verify_pty.py -v
python3 -B scripts/verify-pty.py --tests readiness,tab --timeout 10
```

覆盖参数、unsupported分支、控制序列与回显隔离、分片DSR、输出上限、延迟标记、临时环境、自建进程清理、负例Tab和受控fzf/ble fixture。fixture通过不代表真实插件组合通过。

## 已授权真实WSL冒烟

环境由外层选择，名称/账号不写为工具默认值。未安装、未sudo、未修改用户启动配置；启动真实配置可能写正常缓存。结果仅保存布尔证据/状态，不保存原始屏幕。

| 检查 | 实际结果 | 范围 |
|---|---|---|
| readiness | pass | 无-c交互shell、唯一执行标记与恢复 |
| tab | fail: timeout | 受控路径补全协议未完成；不是git子命令测试 |
| fzf-history | fail: timeout | 未满足受控header/候选/恢复协议 |
| fzf-files | pass | 受控文件候选界面及取消恢复 |
| fzf-dirs | pass | 受控目录候选界面及取消恢复 |
| ble | pass | 加载、attach和选项状态；建议接受和视觉仍未测 |

首次全套因就绪握手丢弃延迟响应而超时，修复后readiness通过。Tab和历史测试调整测试上下文后仍未通过；已停止重复探针，不削弱断言、不修改用户环境迎合测试。**真实4/6通过，两项兼容性未解决，工具保留实验性标签。**

没有基线模型对比、触发率基准、跨发行版兼容性或建议视觉验收；不宣称全绿。

# Podman 实证迭代（2026-09-29）

## Ubuntu 24.04

授权本机 Podman 隔离容器，无宿主 HOME 挂载和端口发布；未连接远程，未修改既有 WSL。基础镜像摘要 `sha256:019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467`。Bash 5.2.21、bash-completion 2.11、fzf 0.44.1、zoxide 0.9.3、Python 3.12。ble 使用现场官方 GitHub API 返回的 v0.4.0-devel3 发布归档（-2），SHA256 `bdcdcfff216495403adf82a701fe41675f64b64644dc77caabd3e015871ebd61`。通过官方 HTTPS 获取；API 无 digest，未提供独立签名认证。

| 验收 | 实测 |
|---|---|
| 原始验证器 | 4/6；Tab、Ctrl-R 超时；同 USER/LANG 对照仍2项失败 |
| 修改后真实插件 | 初轮6/6、独立账号6/6、回滚重装后连续两轮各6/6 |
| PTY 离线回归 | 23/23，无跳过；保留负例Tab和防回显断言 |
| 配置夹具 Unix 单测 | 24通过，1个Windows-only跳过（总25） |
| 配置夹具 Windows 单测 | 9通过，16个Unix-only跳过（总25） |
| 安装重入 | 首次applied、相同内容unchanged |
| 生命周期 | 8/8：重复source不增PATH/hook、cd不接管、z跳转、两类非交互无噪声、拒绝后续编辑、精确恢复、移除managed init |
| 未配置账号负对照 | readiness/Tab通过；fzf三项/ble均unsupported，exit2，不报全绿 |
| 真实XDG首次登录 | 人工暴露缺少用户缓存目录导致权限错误；以账号身份创建私有目录后，真实XDG readiness/ble均通过 |
| 人工体验 | 用户在修复后确认“完美 已经实现了”；这是总体体验确认，不冒充逐项自动证据 |

## 经失败修复的通用规则

1. 继承的SOCKS代理与apt不兼容；传输层报错不能通过禁用签名校验修复。
2. 精简镜像排除文档目录，包清单虽列fzf脚本但磁盘不存在。窄范围保留规则+同版本重装后文件恢复。
3. Tab与Enter同批输入造成协议超时；改为观测补全后Enter，仍需执行随机文件内容作为最终证据。
4. 执行标记不等于编辑器就绪；快捷键前等待该标记之后的新唯一提示符。
5. 临时XDG预建目录掩盖首次登录缓存缺失；增加真实XDG对照，不放宽共享安装目录权限。

## Debian 13 兼容性

基础为官方 Python 3.12 slim / Debian 13.4 镜像，摘要 `sha256:0bbd3d5f3abb2024c1b92ce69e8bdfefa17c248999827c34e2ed52ba0772da1b`。Bash 5.2.37、bash-completion 2.16.0、fzf 0.60.3、zoxide 0.9.7。直连源下载停滞；现场验证可达代理支持HTTP后仅在apt进程设置代理，并加总预算，安装完成，未修改宿主设置。

精简镜像同样没有包清单中的fzf脚本，但该版本 `fzf --bash` 可用。生成官方集成内容、bash -n 后交给同版ble官方适配层；不是自行仿造widget。首次插件unsupported，启动诊断证实缺少 `ps` 导致ble取消加载；补齐procps后全套 **6/6通过**，真实XDG启动 **2/2通过**，生命周期 **8/8通过并完成配置回滚**。安装成功不等于依赖完整，unsupported也不是验收成功。

## 限制与保留

PTY仍为实验性：控制序列剥离不是完整终端模拟，固定CPR位置、视觉布局、建议接受、git语义及fzf **未自动覆盖。旧WSL两项失败未重新跑，不把容器修复说成WSL已复验。没有模型触发率/基线模型benchmark。容器仅验证用户空间，不等同完整虚拟机。可复用测试和执行边界见 [隔离安装回归](../references/container-lab.md)。

## 保守健壮性补强（2026-09-30）

- 运行时代码仅新增TemporaryDirectory创建的OSError处理：逐测试fail/setup/temporary_directory_unavailable、exit1、不启动shell，不泄露异常路径。正常PTY流程/键序/加载逻辑未改。
- 新负例包含FileNotFoundError、PermissionError、一般OSError；修改前在Alpine复现3个异常，修复后通过。
- 最终Alpine24/24、OpenWrt24/24；Windows18通过+6个Unix集成skip。Windows测试桩补模拟isabs与SIGKILL，不修改运行时平台判定。
- 文档增补对象级变更清单、夹具回滚子集边界及冷启动验收门槛；不新增通用安装器，不改变configure.py/lifecycle.py及已确认账号配置。
- 本轮仅运行controluser的干净shell回归；未重新声明全插件人工验收，未重启容器/设备，冷启动仍not_tested。此前用户已总体确认Alpine/OpenWrt配置成功，不能替代冷启动证据。


