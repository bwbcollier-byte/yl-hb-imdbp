#!/bin/bash

echo "🚀 Starting Overnight IMDbPro Contacts Extraction..."
echo "This will continuously run batches of 100 profiles until every record is synced."
echo "------------------------------------------------------------------------"

while true; do
  # Run the node script and capture output, but also print it to terminal in real-time
  node imdbpro-crm-induction.js | tee /tmp/imdb_batch.log
  
  # Check the log for our termination string defined in the node script
  if grep -q "✅ Done." /tmp/imdb_batch.log; then
    echo "🎉 ALL RECORDS HAVE BEEN PROCESSED!"
    break
  fi
  
  echo "------------------------------------------------------------------------"
  echo "⏱️  Batch complete wrapper. Cooling down for 10 seconds to avoid server bans..."
  sleep 10
done
