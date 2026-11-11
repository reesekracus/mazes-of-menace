#!/usr/bin/env bash
# Regression checks for the NetHack 5.0 bridge (engine50.js) in Node.
# Usage: scripts/test50.sh [path/to/nethack.js]   (default: vendor50/nethack.js)
cd "$(dirname "$0")/.."
export NH=50
[ -n "${1:-}" ] && export NH_MODULE="$1"
T=$(mktemp -d); echo '{}' > "$T/none.json"
pass=0; fail=0
run() { timeout 90 node scripts/headless.mjs "$1" "$T/none.json" ${2:-} 2>&1; }
check() { # name, output, regex
  if grep -qE -- "$3" <<<"$2"; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1"; fi
}

o=$(run 's');                 check 'boots to map + status'      "$o" 'STATUS TITLE=Greg the .*HP=[0-9]+'
                              check 'welcome message'            "$o" 'welcome to NetHack!'
                              check 'tiles drawn with @'         "$o" '@'
o=$(run 'i,a,ESC');           check 'inventory -> item actions'  "$o" 'Do what with the'
o=$(run '#pray,y');           check 'ext command index (#pray)'  "$o" 'You begin praying'
o=$(run '#annotate,Here,#overview'); check 'getline'             "$o" 'Level 1: "Here"'
o=$(run 'D,a,d');             check 'multi-select menu + drop'   "$o" 'You drop (an|[0-9]+) uncursed food ration'
# Travel legitimately refuses when a hostile monster is next to you, so allow a few random games.
ct=0
for try in 1 2 3; do
  o=$(run 'clickfloor,where')
  h=$(grep -oE 'click floor [0-9]+ [0-9]+' <<<"$o" | awk '{print $3", "$4}')
  if grep -q "hero now \[ $h \]" <<<"$o"; then ct=1; break; fi
done
check 'click travel' "$ct" '^1$'
o=$(run 'S,y' "$T/save.json"); check 'save + exit detected'      "$o" 'FILES .*/save/0Greg'
o=$(timeout 90 node scripts/headless.mjs 's' "$T/save.json" 2>&1); check 'restore' "$o" 'welcome back to NetHack'
o=$(run '#quit,y,q');         check 'quit + exit detected'       "$o" 'FILES .*/xlogfile\([1-9]'
a=$(run 's' | sed -n '/script exhausted/,/STATUS/p' | md5sum)   # two games started back to back
b=$(run 's' | sed -n '/script exhausted/,/STATUS/p' | md5sum)
if [ "$a" != "$b" ]; then pass=$((pass+1)); echo "ok   random seed differs between games"; else fail=$((fail+1)); echo "FAIL random seed"; fi

rm -rf "$T"
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
