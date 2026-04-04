#!/bin/bash

echo "🚀 Starting Overnight IMDbPro Company Enrichment Extraction..."
echo "This will continuously run batches of 100 properties to enrich Hb_companies until every record is synced."
echo "------------------------------------------------------------------------"

while true; do
  # Run the node script and capture output
  node imdbpro-company-induction.js | tee /tmp/imdb_company_batch.log
  
  # Check the log for our termination string defined in the node script
  if grep -q "✅ Done." /tmp/imdb_company_batch.log; then
    echo "🎉 ALL COMPANY RECORDS HAVE BEEN ENRICHED!"
    break
  fi
  
  echo "------------------------------------------------------------------------"
  echo "⏱️  Batch complete wrapper. Cooling down for 10 seconds to avoid server bans..."
  sleep 10
done
