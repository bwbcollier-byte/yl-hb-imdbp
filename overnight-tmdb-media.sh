#!/bin/bash
# TMDB Media Enrichment - Overnight Runner

set -e
cd "$(dirname "$0")"

echo "📺 TMDB Media & Cast Enrichment"
echo "==============================="

# Process 25 batches of 20 media records (500 per run)
for ((start=1; start<=25; start++)); do
    echo ""
    echo "📦 Batch $start of 25..."
    
    node tmdb-media-induction.js
    
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Failed at batch $start"
        exit $EXIT_CODE
    fi
    
    echo "✅ Batch $start complete. Cooling down..."
    sleep 10
done

echo ""
echo "🎉 Media enrichment complete!"
