#!/bin/sh
# Static, POSIX-compatible inventory. Run as a child process, not by sourcing.
# Does not execute discovered tools, load startup files, create files or connect.
if [ "$#" -gt 1 ]; then
  printf '%s\n' 'Too many arguments.' >&2
  exit 2
fi
case ${1-} in
  --help|-h)
    printf '%s\n' 'Usage: sh probe-bash.sh [--help]' \
      'Reports current process only; no startup loading or active feature tests.'
    exit 0 ;;
  '') ;;
  *) printf '%s\n' 'Unsupported argument; use --help.' >&2; exit 2 ;;
esac
# Escape controls in all externally supplied values to avoid terminal injection.
# sed is the only external utility; absence fails rather than printing raw data.
if ! command -v sed >/dev/null 2>&1; then
  printf '%s\n' 'ERROR: sed is required for safe output.' >&2
  exit 3
fi
field() {
  printf '%s=' "$1"
  printf '%s\n' "$2" | LC_ALL=C sed -n l
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' 'ERROR: output formatting failed.' >&2
    exit "$rc"
  fi
}
field probe.version 1
field observation.scope 'current child process; parent functions and unexported variables not observable'
field process.argv0 "$0"
field process.flags "$-"
field process.bash_version "${BASH_VERSION-unset}"
field environment.shell "${SHELL-unset}"
field environment.term "${TERM-unset}"
field environment.lang "${LANG-unset}"
field environment.lc_all "${LC_ALL-unset}"
field environment.lc_ctype "${LC_CTYPE-unset}"
case $- in *i*) field process.interactive yes ;; *) field process.interactive no ;; esac
if [ -t 0 ]; then field tty.stdin yes; else field tty.stdin no; fi
if [ -t 1 ]; then field tty.stdout yes; else field tty.stdout no; fi
if [ -t 2 ]; then field tty.stderr yes; else field tty.stderr no; fi
for tool in bash fzf zoxide git bat batcat eza rg fdfind; do
  resolved=$(command -v "$tool" 2>/dev/null)
  rc=$?
  if [ "$rc" -eq 0 ]; then field "tool.$tool" "$resolved"; else field "tool.$tool" missing; fi
done
if [ -n "${HOME-}" ]; then
  for name in .bashrc .bash_profile .bash_login .profile .inputrc .blerc; do
    if [ -r "$HOME/$name" ]; then
      field "startup.$name" readable
    elif [ -e "$HOME/$name" ]; then
      field "startup.$name" unreadable
    else
      field "startup.$name" absent
    fi
  done
else
  field startup.home unset
fi
for item in /etc/profile /etc/bash.bashrc /etc/profile.d /usr/share/bash-completion/bash_completion; do
  if [ -r "$item" ]; then field system.path "$item (readable)"; else field system.path "$item (absent or unreadable)"; fi
done
field feature_tests 'not run; inventory is not proof of completion, suggestions, bindings or attach'
printf '%s\n' 'PROBE_COMPLETE'
