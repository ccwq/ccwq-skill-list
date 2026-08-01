# ChatGPT Web Skill 浏览器任务容错与隔离规格

## Problem Statement

`chatgpt-web-skill` 依赖 `agent-browser` 操作持续变化的 ChatGPT Web UI。现有实现已经能够配置 session/CDP、检查 Project 归属、确认消息提交并在图片可见后立即截图，但 tab 的获取、复用、创建、所有权记录和清理仍需要 LLM 重复参与。动作前后实时 snapshot 也主要依靠流程纪律，发生中断或误操作时，难以可靠判断某个 tab 是否由本次任务创建、是否可以安全关闭，以及动作是否已经生效。

用户需要把已验证且跨页面稳定的经验固化为 Python 辅助能力，减少 LLM 拼装命令和解释机械结果的工作，同时保留对动态 selector、ref、Project 归属和视觉质量的实时验证，避免过度拟合某次页面结构。

## Solution

在保持 `chatgpt-web-skill` 版本 `1.12.0` 和现有接口兼容的前提下，引入统一的浏览器任务辅助入口 `browser_task`。它继续依赖 `agent-browser` skill 与 CLI，不实现独立浏览器驱动。

`browser_task` 使用临时 lease 管理一次浏览器任务的 tab 所有权，提供 `acquire`、`status`、`action` 和 `release` 四个子命令：精确复用已有 URL 或显式创建专用 tab，记录稳定 tab ID，对任意 agent-browser 动作自动保存前后 snapshot，并且只关闭 lease 明确标记为本次创建的 tab。所有输出使用结构化 JSON，使调用方只需读取少量状态；详细页面证据保存在临时目录中，按需查看。

动态 DOM 控件、selector、ref、Project 选择和图片质量不进入固定脚本契约，仍由实时 snapshot、现有运行时检查和截图完成验证。

## User Stories

1. As a skill caller, I want browser tasks to reuse an exactly matching open URL, so that the workflow does not create unnecessary duplicate tabs.
2. As a regression-test runner, I want to force creation of a dedicated tab, so that tests never occupy an existing user tab.
3. As a skill caller, I want every acquired task to return a stable tab ID, so that subsequent commands cannot silently drift to another tab.
4. As a user with existing browser work, I want the skill to distinguish reused tabs from newly created tabs, so that my existing tabs are never closed during cleanup.
5. As a skill caller, I want tab ownership recorded outside the LLM context, so that cleanup remains reliable after long or interrupted workflows.
6. As a skill caller, I want the lease to record session and optional CDP configuration, so that all later operations use the same browser context.
7. As a user running different browser configurations, I want CDP to come only from an explicit argument or configured environment variable, so that no machine-specific port is hard-coded.
8. As an existing user of the skill, I want the current path-derived session naming behavior preserved, so that the enhancement does not connect to a new daemon session unexpectedly.
9. As a skill caller, I want every state-changing action to capture a snapshot before and after execution, so that the action has inspectable evidence.
10. As an advanced caller, I want `action` to pass arbitrary agent-browser commands through, so that the helper does not artificially limit CLI capability.
11. As a caller diagnosing failure, I want the action exit code and verification failure reported separately, so that a failed post-action snapshot does not hide what the action itself returned.
12. As a caller recovering from an interrupted task, I want stale leases reported without automatic tab closure, so that a tab possibly taken over by the user is not destroyed.
13. As a caller cleaning up a completed task, I want `release` to re-read the live tab list, so that cleanup is verified against current browser state.
14. As a caller cleaning up a reused tab, I want `release` to leave the page open, so that reuse never becomes accidental ownership.
15. As a caller cleaning up a newly created tab, I want `release` to close only that tab and confirm its disappearance, so that unrelated tabs remain untouched.
16. As a caller investigating a regression, I want lease, snapshot and screenshot artifacts stored under a dedicated temporary directory, so that evidence does not pollute the repository.
17. As a privacy-conscious user, I want temporary evidence retained by default but removable explicitly, so that diagnostics and cleanup are both possible.
18. As a caller using PowerShell, I want command arguments passed through without a second custom encoding scheme, so that quoted refs such as `'@e123'` remain compatible with agent-browser conventions.
19. As a caller executing complex JavaScript, I want eval payloads to continue using stdin, so that PowerShell quoting cannot corrupt expressions.
20. As a caller on an unstable connection, I want read-only tab and snapshot operations retried briefly, so that transient failures do not abort otherwise safe checks.
21. As a user sending prompts or creating images, I want state-changing actions to avoid blind automatic retries, so that messages, tabs, uploads or generations are not duplicated.
22. As a test maintainer, I want deterministic lease and action behavior covered by offline tests, so that most regressions are caught without opening ChatGPT.
23. As a maintainer, I want the four existing live scenarios retained, so that Project routing, message submission, image convergence and browser isolation remain understandable as end-to-end behavior.
24. As a user reviewing a live regression, I want the test to run sequentially in one newly created tab, so that it does not interfere with existing tabs or create unnecessary browser clutter.
25. As a user paying for image generation, I want the image regression limited to one generation attempt, so that validation has a predictable cost.
26. As a user reviewing test history, I want the generated test chat retained rather than automatically deleted, so that destructive cleanup is never performed implicitly.
27. As a maintainer, I want validated tab lease and verified-action conclusions appended to the versioned experience memory, so that future improvements retain their evidence and boundaries.
28. As a repository user, I want the root skill index and plugin marketplace description synchronized, so that installation metadata accurately reflects the available workflow.

## Implementation Decisions

- Keep the skill metadata and marketplace version at `1.12.0`; the enhancement is backward-compatible and does not replace existing commands.
- Add one Python module/CLI named `browser_task` with `acquire`, `status`, `action` and `release` subcommands. Shared lease parsing, CLI invocation, tab selection, retry and temporary-path logic must remain in this module.
- Continue using the installed `agent-browser` executable when available and fall back to the existing CLI resolution behavior. Do not implement browser automation independently.
- Resolve CDP configuration in this order: explicit `--cdp`, `AGENT_BROWSER_CDP_PORT`, then the project `.env` value `9696`. ChatGPT Web calls must use an existing logged-in browser; never fall back to starting a new browser session.
- Preserve the current default session-name algorithm based on the absolute project path with path separators removed.
- Store each lease beneath `%TEMP%\agent-browser-captures\chatgpt-web-skill\<lease-id>\` on Windows and the equivalent temporary root on other platforms.
- A lease records its identifier, session, optional CDP port, requested URL, normalized URL, stable tab ID, whether the tab was created, lifecycle status and artifact paths.
- Normalize URLs for reuse by removing only a trailing `/`; retain query and fragment. Reuse requires an exact normalized match.
- `acquire <url>` reuses an exact match by default. `acquire <url> --force-new` always creates a dedicated tab. Both return a lease path and stable tab ID.
- `status <lease>` validates the lease schema and reports whether its tab still appears in a fresh tab list. It must not mutate browser state.
- `action <lease> -- <agent-browser arguments...>` accepts arbitrary agent-browser arguments. Before execution it selects the lease tab and saves a live snapshot; after execution it attempts to select the same tab and save another snapshot.
- `action` reports the agent-browser return code independently from snapshot verification. If the tab or session disappears, return `ok=false`, set the after-snapshot field to null, record `verification_error`, and mark the lease lifecycle as `uncertain`.
- Complex JavaScript continues through the existing stdin-based eval path; the new action interface does not introduce a JSON action language.
- `release <lease>` closes a tab only when the lease records `created=true`. Reused tabs are never closed. A created tab is closed by stable ID and a fresh tab list must confirm its disappearance.
- Stale or uncertain leases are never auto-released on startup. They are reported for explicit inspection and release.
- `release --purge` may remove the lease directory only after release processing and only after resolving and verifying that the target is beneath the dedicated temporary root. Default release retains artifacts.
- Retry read-only operations such as tab listing, snapshot and URL/title reads at most twice. Do not automatically retry arbitrary `action` commands or other state-changing browser operations.
- Emit exactly one JSON object on stdout for every subcommand; write diagnostics to stderr. Common fields include `ok`, `operation`, `lease`, `tab_id` and `created`. Action results additionally expose `returncode`, `before_snapshot`, `after_snapshot` and optional `verification_error`.
- Keep Project membership, prompt submission and image visibility checks in the existing runtime-check layer. Keep selector/ref discovery, Project control selection, authorization decisions and visual quality review with the live agent workflow.
- Update the skill instructions to route tab acquisition, verified actions and cleanup through `browser_task`, while retaining mandatory live snapshots and existing runtime checks.
- Update the root parameter quick reference and marketplace description to mention lease-based tab isolation and verified actions without changing the plugin source, category or version.
- After successful validation, append two sanitized experience entries through the experience-memory CLI: lease ownership/cleanup, and action-before/after snapshot verification. Do not manually edit the experience file.
- Commit the complete enhancement as one atomic conventional commit using a subagent and the `git-up -pc` workflow. Include only related skill, script, test, specification, README, marketplace and experience changes.

## Testing Decisions

- Treat the `browser_task` command-line JSON contract as the primary test seam. Tests should assert observable commands, JSON results, lease state transitions and filesystem safety rather than private helper implementation.
- Extend the existing offline unittest suite and subprocess mocks instead of adding a separate test framework.
- Test CDP precedence, default session compatibility, URL normalization, exact reuse, forced creation, lease serialization, reused-tab release, created-tab release, stale/uncertain status, post-action snapshot failure, read-only retry limits and purge path containment.
- Verify that arbitrary action arguments are preserved and that the selected lease tab is re-established before each snapshot/action operation.
- Verify that state-changing actions are not automatically retried, while designated read-only operations stop after at most two retries.
- Preserve the four high-level regression scenarios: Project membership requires at least two live signals; message submission requires the marker to render outside the composer; visible generated images trigger immediate screenshot and return; CDP/session/tab isolation includes lease acquisition, forced-new behavior, verified action artifacts and safe release.
- Run live scenarios sequentially in one newly created dedicated tab using `--force-new`. Never close or repurpose existing tabs.
- Use the invocation-time configured CDP value for live validation; if no CDP value is configured, omit the argument.
- Limit the image scenario to one generation request. Once a snapshot contains visible generated-image evidence, take the screenshot immediately and perform no further dimension polling or waiting.
- Retain the live regression chat and temporary evidence. Close only the dedicated test tab and confirm its disappearance with a fresh tab list.
- Run the complete offline suite, JSON validation for marketplace metadata and Git whitespace checks before committing.

## Out of Scope

- Hard-coding ChatGPT DOM selectors, agent-browser refs, tab IDs or private Project URLs. The project-level `.env` CDP value `9696` is an explicit environment configuration, not a DOM/API contract.
- Replacing `agent-browser` with Playwright, raw CDP WebSocket control or another independent browser implementation.
- Automatically choosing dynamic ChatGPT controls, resolving duplicate Project names or judging generated-image quality without live evidence.
- Automatically retrying prompt submission, image generation, uploads, navigation or arbitrary actions.
- Automatically deleting test chats, Projects, generated images or user browser tabs.
- Migrating or bumping the versioned experience file to `1.13.0`.
- Publishing the specification to an external issue tracker; this request produces a repository Markdown specification only.

## Further Notes

- The working tree already contains uncommitted additions for the four scenario regression tests and their live-case documentation. Implementation must preserve and integrate those related changes rather than overwrite them.
- PowerShell callers must continue quoting refs such as `'@e123'`; PowerShell does not support `&&` in the required workflow.
- A successful CLI action is not equivalent to a successful ChatGPT operation. Project checks, rendered-message markers, image evidence and visual review remain the final sources of business-level truth.
- The test seam described above matches the agreed expectation: one high-level browser-task contract, with existing runtime checks retained as specialized evidence providers.
