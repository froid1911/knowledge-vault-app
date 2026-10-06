#!/usr/bin/env bash
# THROWAWAY: run one variant of the probe Switchboard and record timings/RSS.
# usage: bin/measure.sh <variant-name> [env assignments...]
set -u
SP=/home/beast/Documents/Powerhouse/vault-standalone-spike
V=$1; shift
PORT=${SPIKE_PORT:-4101}
OUT=$SP/measure/$V; mkdir -p $OUT
LOG=$OUT/switchboard.log; : > $LOG
rss_tree() { # RSS in MB of the pid and all descendants
  local pids="$1 $(pgrep -P $1 | tr '\n' ' ')"; local sum=0
  for p in $pids; do local r=$(ps -o rss= -p $p 2>/dev/null | tr -d ' '); sum=$((sum + ${r:-0})); done
  echo $((sum / 1024))
}
gql() { curl -s -m 120 -o "$2" -w '%{http_code} %{time_total}' -H 'content-type: application/json' "http://localhost:$PORT/graphql" -d "$1"; }
T0=$(date +%s.%N)
env "$@" node $SP/bin/run-switchboard.mjs >> $LOG 2>&1 &
PID=$!
echo "variant=$V pid=$PID"
# 1. time to GraphQL ready
until [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' -H 'content-type: application/json' http://localhost:$PORT/graphql -d '{"query":"{__typename}"}')" = "200" ]; do
  kill -0 $PID 2>/dev/null || { echo "process died"; tail -20 $LOG; exit 1; }; sleep 0.5; done
T_READY=$(python3 -c "print(round($(date +%s.%N)-$T0,1))"); echo "ready_s=$T_READY rss_mb=$(rss_tree $PID)"
# 2. find the vault drive (the one holding a bai/vault-config node) and wait for the graph index to answer
DRIVE=$(curl -s -m 60 -H 'content-type: application/json' "http://localhost:$PORT/graphql" -d '{"query":"{ findDocuments(search: { type: \"powerhouse/document-drive\" }) { items { id slug name state } } }"}' | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]["findDocuments"]["items"]
vault=[x for x in d if any(n.get("documentType")=="bai/vault-config" for n in (x.get("state") or {}).get("global",{}).get("nodes",[]))]
vault.sort(key=lambda x: -len(x["state"]["global"]["nodes"]))
print(vault[0]["id"] if vault else (d[0]["id"] if d else ""))')
echo "drive=$DRIVE"
[ -z "$DRIVE" ] && { echo "no drive in store: skipping index/burst"; T_INDEX=0; FIRST="n/a"; LAT=""; REST="n/a"; R_BURST=$(rss_tree $PID); sleep 60; R_IDLE30=$(rss_tree $PID); R_IDLE60=$(rss_tree $PID); echo "rss_idle_mb=$R_IDLE60"; }
[ -n "$DRIVE" ] && until gql "{\"query\":\"{ knowledgeGraphStats(driveId: \\\"$DRIVE\\\") { nodeCount edgeCount } }\"}" $OUT/stats.json | grep -q '^200' && grep -q nodeCount $OUT/stats.json; do sleep 1; done
[ -n "$DRIVE" ] && T_INDEX=$(python3 -c "print(round($(date +%s.%N)-$T0,1))") && echo "index_ready_s=$T_INDEX stats=$(cat $OUT/stats.json | head -c 160)"
# 3. idle RSS samples
if [ -n "$DRIVE" ]; then
sleep 30; R_IDLE30=$(rss_tree $PID); sleep 30; R_IDLE60=$(rss_tree $PID); echo "rss_idle30_mb=$R_IDLE30 rss_idle60_mb=$R_IDLE60"
# 4. query burst: first semantic search (loads the embedding model), then 10 more, stats, REST notes page
Q='{"query":"{ knowledgeGraphSemanticSearch(driveId: \"'$DRIVE'\", query: \"how does the reactor store operations\", mode: SEMANTIC, limit: 6) { similarity node { title } } }"}'
FIRST=$(gql "$Q" $OUT/search1.json); echo "search_first=$FIRST"
LAT=""; for i in $(seq 1 10); do LAT="$LAT $(gql "$Q" /dev/null | cut -d' ' -f2)"; done; echo "search_next_s=$LAT"
REST=$(gql "{\"query\":\"{ document(idOrSlug: \\\"$DRIVE\\\") { document { id state } } }\"}" $OUT/drive-doc.json); echo "drive_document_read=$REST size=$(stat -c %s $OUT/drive-doc.json)"
R_BURST=$(rss_tree $PID); echo "rss_after_burst_mb=$R_BURST"
fi
# 5. shutdown
SNAP_BEFORE=$(stat -c '%Y %s' ${SPIKE_REACTOR_DB:-$SP/store-a/reactor-storage}/snapshot.bin 2>/dev/null || echo "n/a")
T1=$(date +%s.%N); kill -INT $PID; while kill -0 $PID 2>/dev/null; do sleep 0.5; done
T_DOWN=$(python3 -c "print(round($(date +%s.%N)-$T1,1))")
SNAP_AFTER=$(stat -c '%Y %s' ${SPIKE_REACTOR_DB:-$SP/store-a/reactor-storage}/snapshot.bin 2>/dev/null || echo "n/a")
echo "shutdown_s=$T_DOWN snapshot_before='$SNAP_BEFORE' after='$SNAP_AFTER'"
python3 - "$V" "$T_READY" "$T_INDEX" "$R_IDLE30" "$R_IDLE60" "$R_BURST" "$T_DOWN" "$FIRST" "$LAT" "$REST" > $OUT/summary.json <<'PY'
import json,sys
v,ready,idx,r30,r60,rb,down,first,lat,rest=sys.argv[1:]
json.dump({"variant":v,"ready_s":float(ready),"index_ready_s":float(idx),"rss_idle30_mb":int(r30),"rss_idle60_mb":int(r60),"rss_after_burst_mb":int(rb),"shutdown_s":float(down),"search_first":first,"search_next_s":lat.split(),"rest_search":rest},sys.stdout,indent=1)
PY
echo "wrote $OUT/summary.json"; grep -iE "error|warn" $LOG | grep -viE "sentry|telemetry" | head -8
