#!/bin/bash
# IMDbPro Starmeter Discovery - Overnight Runner
# Scrapes top-ranked stars page by page and syncs to Supabase.

set -e
cd "$(dirname "$0")"

echo "⭐ IMDbPro Starmeter Discovery"
echo "=============================="

# Process pages 1-100 in batches of 10 pages each
for ((start=1; start<=91; start+=10)); do
    echo ""
    echo "📦 Pages $start-$((start+9))..."
    
    STARMETER_START_PAGE=$start STARMETER_MAX_PAGES=10 node imdbpro-starmeter-induction.js
    
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Failed at page $start"
        exit $EXIT_CODE
    fi
    
    echo "✅ Pages $start-$((start+9)) complete. Cooling down..."
    sleep 30
done

echo ""
echo "🎉 Starmeter sync complete!"
