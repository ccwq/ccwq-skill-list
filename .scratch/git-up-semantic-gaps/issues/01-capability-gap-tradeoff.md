# 四个能力缺口的取舍判定

Status: resolved
Type: grilling
Parent: ../map.md
Blocked by: none

## Question

git-up 语义执行对二进制、重命名、复制、模式变更这四类操作报 `unsupported_operation` 或校验失败。它们是否值得补齐实现？

## Answer

结论：三项不补，一项只改报错时机。依据是实测行为，不是规格列举。

### 实测结果

| 操作 | 今天能否提交 | 实测行为 |
| --- | --- | --- |
| 二进制，`content` 模式 | 能 | 提交 blob 与原文件逐字节相同，`verification.status` 为 `verified` |
| 二进制，`GIT binary patch` 格式 | 不能 | `unsupported_operation`，信息含 `binary` |
| 重命名，一步骤内删除加新增 | 能 | 提交被 Git 识别为 `R100 old.txt new.txt`，校验通过 |
| 重命名，Git `rename from`/`rename to` 格式 | 不能 | `unsupported_operation`，信息含 `rename` |
| 复制 | 能 | 表达为新增即可。Git 的 copy 补丁格式报 `unsupported_operation` |
| 模式变更，`patch` 模式 | 提交能成功，校验失败 | commit tree 为 `100755`，但返回 `target_verification_failure` |
| 模式变更，`content` 模式 | 部分 | 新文件恒为 `100644`；已存在的 `100755` 文件保留 `755` |

### 逐项判定

**二进制：不补。** `content` 模式已覆盖真实需求，且逐字节一致。未实现的只是 Git 二进制补丁的书写格式，不是能力。Agent 换用 `content` 模式即可。

**复制：不补。** 复制在语义上就是新增，内容模式加新增路径即可。Git 的 copy 补丁格式只影响写法。

**重命名：不补。** 删除加新增已经能表达，Git 自身会把结果识别为重命名。要求同一步骤声明两条路径是正确约束，不是缺陷。Git 的 rename 补丁格式同样只是写法。

**模式变更：不补能力，但要提前报错时机。** 这是四项里唯一真实的缺口，且成因不是"缺功能"，而是目标快照的结构性假设。快照用临时 index 跑 `git add -A` 从工作区推导目标内容，纯索引的 mode 变更无法从工作区表达，于是目标树记 `100644`、最终树记 `100755`，校验在提交已经落地之后才报失败。

这个失败形态最糟：提交已写进历史，报告却说失败，且信息把原因指向"树不匹配"，掩盖了真实成因。改成扫描到 `old mode`/`new mode` 就返回 `unsupported_operation`，即可在提交前明确拒绝。

### 支撑理由

- 缺口来源是规格列举，不是实际撞到。工具至今的真实使用只有一次（提交本次实现本身），那次没有触及这四项中的任何一项。
- 规格选择"显式失败而非猜测"是对的姿态。四项里有三项根本不会触发失败，因为能力已具备。
- 补齐三项的书写格式只会增加执行器的复杂度，换来的是同一结果的另一种写法。

### 顺带查明

`content` 模式走 `git hash-object --path`，会过 clean filter。无 NUL 字节的"二进制"文件会被 Git 的文本启发式当作文本，CRLF 转 LF。这不是工具缺陷，与 `git add` 的行为一致，目标树也用同一 filter 构造，三者相符。

## Evidence

- 二进制 content 模式逐字节一致，测试 `test-space/git-up-semantic-tests/run_tests.mjs` 的 `testVerificationCoversBinaryFile`。
- 重命名删除加新增，临时仓库实测提交为 `R100 old.txt new.txt`，`verification.status` 为 `verified`。
- 模式变更，临时仓库实测 `git ls-tree HEAD` 为 `100755`，同时执行返回 `target_verification_failure`，`target_tree` 与 `final_tree` 不同。
- 独立探针子代理复核四项，结论与上表一致。
