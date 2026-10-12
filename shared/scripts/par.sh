#!/bin/sh
# usage: [ENV=...] sh scripts/par.sh <gamesPerWorker> <jackLevel> <policeLevel>  (4 workers)
n=$1; j=$2; p=$3; out=.arena/$$; mkdir -p $out
for w in 0 1 2 3; do SEED0=$((w * 1000)) JSON=1 npx tsx scripts/arena.ts $n $j $p < /dev/null > $out/$w.json 2>&1 & done
wait
node -e "
const fs=require('fs');let w=0,g=0;const r={};
for(const f of fs.readdirSync('$out')){const d=JSON.parse(fs.readFileSync('$out/'+f,'utf8'));w+=d.jackWins;g+=d.games;for(const[k,v]of Object.entries(d.reasons))r[k]=(r[k]||0)+v;}
console.log('jack=$j police=$p: Jack won '+w+'/'+g+' ('+(100*w/g).toFixed(0)+'%)');
for(const[k,v]of Object.entries(r).sort((a,b)=>b[1]-a[1]))console.log('  '+v+'x '+k.slice(0,60));"
