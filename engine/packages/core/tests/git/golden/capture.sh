#!/bin/sh
# Regenerates the raw git output these goldens are parsed from. The expected .json files are
# reviewed by hand and are not regenerated. Flags match statusArgs and diffArgs in core/src/git.
# Usage: capture.sh (from any directory; needs git and a writable temp directory)
set -eu

golden="$(cd "$(dirname "$0")" && pwd)"
make_repos="$golden/../../../../testkit/fixtures/git/make-repos.sh"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME="Pica Fixture" GIT_AUTHOR_EMAIL="fixture@pica.test"
export GIT_COMMITTER_NAME="Pica Fixture" GIT_COMMITTER_EMAIL="fixture@pica.test"
export GIT_AUTHOR_DATE="@1700000000 +0000" GIT_COMMITTER_DATE="@1700000000 +0000"

status() {
  git -c core.quotePath=false status --porcelain=v2 -z --branch --untracked-files=all > "$golden/$1.status"
}
diff() {
  name="$1"
  shift
  git -c core.quotePath=false -c color.ui=false -c diff.suppressBlankEmpty=false diff \
    --no-color --no-ext-diff --no-textconv --no-relative --full-index --find-renames \
    --src-prefix=a/ --dst-prefix=b/ --submodule=short "$@" > "$golden/$name.diff"
}

"$make_repos" "$scratch/fixtures"
cd "$scratch/fixtures/work"
status dirty-worktree
diff head-mixed HEAD
diff unstaged
diff staged-rename --cached

git clone --quiet ../remote.git "$scratch/detached"
cd "$scratch/detached"
git checkout --quiet --detach HEAD~1
status detached

git init --quiet --initial-branch=main "$scratch/initial"
cd "$scratch/initial"
echo "first" > first.txt
git add first.txt
echo "scratch" > scratch.txt
status initial

git init --quiet --initial-branch=main "$scratch/conflict"
cd "$scratch/conflict"
printf 'shared\n' > both.txt
git add both.txt
git commit --quiet -m base
git checkout --quiet -b other
printf 'other side\n' > both.txt
printf 'added on other\n' > added.txt
git add both.txt added.txt
git commit --quiet -m other
git checkout --quiet main
printf 'main side\n' > both.txt
printf 'added on main\n' > added.txt
git add both.txt added.txt
git commit --quiet -m main
git merge --quiet other > /dev/null 2>&1 || true
status conflict
diff conflict

git init --quiet --initial-branch=main "$scratch/odd"
cd "$scratch/odd"
printf 'run\n' > script.sh
printf '\000old binary\377' > old.bin
printf 'spaced\n' > "file with spaces.txt"
git add .
git commit --quiet -m base
chmod +x script.sh
git rm --quiet old.bin
printf '\000new binary\377' > new.bin
printf 'no newline' > no-newline.txt
printf 'spaced and edited\n' > "file with spaces.txt"
printf 'tabbed\n' > "$(printf 'tab\there "quoted" café.txt')"
: > empty.txt
git -c protocol.file.allow=always submodule --quiet add ../fixtures/lib vendor/lib
git add .
status odd-paths
diff odd-paths --cached
