#!/bin/sh
# Builds deterministic git repositories for the R-01 tests.
# Usage: make-repos.sh <empty directory>
# Creates, inside it:
#   remote.git  bare repository that `work` pushes to
#   lib         repository used as the submodule
#   work        repository with a commit history and a dirty working tree covering
#               modified, staged, renamed, deleted, binary, untracked, and submodule changes
set -eu

root="$1"
mkdir -p "$root"
cd "$root"

export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME="Pica Fixture"
export GIT_AUTHOR_EMAIL="fixture@pica.test"
export GIT_COMMITTER_NAME="Pica Fixture"
export GIT_COMMITTER_EMAIL="fixture@pica.test"

tick=1700000000
commit() {
  tick=$((tick + 60))
  GIT_AUTHOR_DATE="@$tick +0000" GIT_COMMITTER_DATE="@$tick +0000" \
    git commit --quiet --no-verify "$@"
}

git init --quiet --bare --initial-branch=main remote.git

git init --quiet --initial-branch=main lib
(
  cd lib
  echo "library" > lib.txt
  git add lib.txt
  commit -m "Add library"
)

git init --quiet --initial-branch=main work
cd work
git config core.autocrlf false

printf 'line 1\nline 2\nline 3\nline 4\nline 5\n' > notes.txt
printf 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\n' > old-name.txt
printf 'remove me\n' > doomed.txt
printf '\000\001\002binary\377\376' > image.bin
printf 'spaced\n' > "with space.txt"
git add .
commit -m "Initial commit"

git -c protocol.file.allow=always submodule --quiet add ../lib vendor/lib
commit -m "Add lib submodule" -m "Pins the library at its first commit."

git remote add origin ../remote.git
git push --quiet --set-upstream origin main

git branch feature
printf 'line 1\nline 2 changed\nline 3\nline 4\nline 5\n' > notes.txt
git add notes.txt
commit -m "Change line 2"

# Working-tree state the status and diff goldens are captured from.
printf 'line 1\nline 2 changed\nline 3\nline 4 edited\nline 5\nline 6\n' > notes.txt
git mv old-name.txt new-name.txt
printf 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\n' > new-name.txt
git add new-name.txt
git rm --quiet doomed.txt
printf '\000\001\002binary changed\377\376' > image.bin
printf 'brand new\n' > "untracked file.txt"
(
  cd vendor/lib
  echo "library v2" > lib.txt
  commit -am "Library v2"
  echo "local edit" >> lib.txt
)
