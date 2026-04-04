#!/bin/bash
# IMDbPro Company Client Roster Extraction - Overnight Batch Runner

set -e

cd "$(dirname "$0")"

TOTAL_BATCHES=10  # 20 companies * 10 batches = 200 companies max per run

echo "🎬 IMDbPro Company Client Roster Extraction"
echo "============================================="
echo "Max Batches: $TOTAL_BATCHES"
echo ""

for ((i=1; i<=TOTAL_BATCHES; i++)); do
    echo "📦 Batch $i/$TOTAL_BATCHES starting..."
    
    node imdbpro-clients-induction.js
    
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Batch $i failed with exit code $EXIT_CODE"
        exit $EXIT_CODE
    fi
    
    echo "✅ Batch $i complete. Cooling down..."
    sleep 30
done

echo ""
echo "🎉 All batches complete!"
