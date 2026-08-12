# Findings

## Existing contract

- `runtime_checks.py project` already requires two runtime Project evidence signals.
- `run_agent_browser.py` locks browser commands to an existing CDP browser and can select a tab before each command.
- The live sidebar previously exposed the target name (`agents-op`) beside an `Open project home` button. Ref IDs are ephemeral, so the locator must use the current DOM rather than cached refs.

## Proposed locator contract

Input: `--name <project-name>`, existing `--cdp` / `--tab` conventions.

Algorithm:

1. Read current DOM through `agent-browser eval` and find an exact visible Project-name button.
2. Locate its adjacent `Open project home` button in the same Project list item; never derive an ID from the project name or call a backend URL.
3. Click that current DOM element through the existing browser channel.
4. Re-read URL, title, and snapshot. Return JSON only when the URL ends in `/project` and project evidence is present.

Output: `{ok, project, url, evidence, error?}`. `url` is a live observation, not a generated value.

## Live DOM verification

- On 2026-08-12, a healthy `agents-op` tab reported a live `/g/g-p-...-agents-op/project` URL, `ChatGPT - agents-op` title, `New chat in agents-op` composer, and Chats/Sources sections.
- Sidebar rows contain name-bearing `[role="button"][data-sidebar-item]` elements and `button[aria-label="Open project home"]` under the same row. The row class is a single token containing `/`, therefore it must be selected as `[class~="group/project-unfurl-row"]`, not `.group/project-unfurl-row`.
- The first click test did not run: the selector syntax failed before a click, and the browser then returned to `chrome-error://chromewebdata/`. No final locator has been written.

## Completed live smoke

- From the ChatGPT home sidebar, `project_locator.py --cdp 9696 --tab 2 --name agents-op` found exactly one row, clicked its current `Open project home` control, and returned the browser-observed `https://chatgpt.com/g/g-p-6a63463091a48191b025304679b55799-agents-op/project` URL.
- Post-navigation `runtime_checks.py project --minimum 2` returned all three evidence signals: `project_url`, `project_title`, and `project_composer`.
- The script never requests or derives data from `/backend-api/*`; its only navigation is a click on a current visible DOM control.

## Boundary regression results

- `agents-op` from a `foo` Project page: passed; URL/title/composer evidence all present.
- `foo` from its own Project page, invoked twice: both passed; behavior is idempotent.
- Missing Project `does-not-exist`: failed with `ok=false`, exit code `1`, and preserved the current `agents-op` URL.
- Invalid tab `999`: failed with tab-range error and exit code `1`.
- Non-ChatGPT tab (Image Grid Spliter): failed with `matchCount=0`, exit code `1`, and preserved the non-ChatGPT URL.
- Existing Projects `teck`, `Gu0F1`, `emig`, and `foo`: all passed with three evidence signals each.
