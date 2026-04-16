#!/bin/bash
# IMDb Top News Scraper - Overnight Batch Runner
# Runs the top news scraper multiple times to accumulate articles.

set -e

cd "$(dirname "$0")"

TOTAL_BATCHES=3  # 3 runs of 5 pages each = up to 750 articles

echo "📰 IMDb Top News Scraper - Overnight Runner"
echo "============================================="
echo "Max Batches: $TOTAL_BATCHES"
echo ""

for ((i=1; i<=TOTAL_BATCHES; i++)); do
    echo "📦 Batch $i/$TOTAL_BATCHES starting..."
    
    MAX_PAGES=5 node imdb-top-news-scraper.js
    
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Batch $i failed with exit code $EXIT_CODE"
        exit $EXIT_CODE
    fi
    
    echo "✅ Batch $i complete. Cooling down..."
    sleep 60
done

echo ""
echo "🎉 All batches complete!"
