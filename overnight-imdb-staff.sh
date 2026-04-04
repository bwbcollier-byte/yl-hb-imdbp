#!/bin/bash
# IMDbPro Company Staff Extraction - Overnight Batch Runner
# Processes companies in batches for memory safety.

set -e

cd "$(dirname "$0")"

BATCH_SIZE=50
TOTAL_BATCHES=10  # 50 * 10 = 500 companies max per run

echo "🏢 IMDbPro Company Staff Extraction"
echo "===================================="
echo "Batch Size: $BATCH_SIZE | Max Batches: $TOTAL_BATCHES"
echo ""

for ((i=1; i<=TOTAL_BATCHES; i++)); do
    echo "📦 Batch $i/$TOTAL_BATCHES starting..."
    
    node imdbpro-staff-induction.js
    
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
