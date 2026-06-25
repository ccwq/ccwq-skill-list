# Changelog

All notable changes to this skill will be documented in this file.

## [1.1.0] - 2026-06-25

### Added / 新增
- 新增 `.env.example` 配置模板（仅含 CDP 浏览器组，脱密占位值）
- 新增 `README.md`：用途、host/server 架构、快速开始、配置变量表、host 端前提、故障排查
- 新增 `rd-mode --init` 问答式初始化流程，自动生成 `~/.config/rd-mode/.env`

### Changed / 变更
- 配置路径迁移至标准 XDG 路径 `~/.config/rd-mode/.env`（原为个人专属目录下的 `.env`）
- `source` 增加容错：配置不存在时提示先运行 `rd-mode --init`，不静默失败
- abc 异常处理强化：补充 `echo $CDP_URL` / `curl $CDP_URL/json/version` / `abc tab` 自检步骤
- 操作边界细化：明确写入 `~/.config/rd-mode/.env` 属于允许操作

### Security / 脱密
- 移除真实内网 IP、SSH 私钥路径、私有目录名等敏感信息，统一改为占位示例值

## [1.0.0]

### Added / 新增
- 初始版本
