#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "🎮 Discover: Games (Box Office)"
DISCOVER_URL="https://pro.imdb.com/discover/title?sortOrder=BOX_OFFICE_GROSS_DESC&ref_=hm_nv_tt_tmm&type=videoGame" DISCOVER_START_PAGE=1 DISCOVER_MAX_PAGES=50 node imdbpro-discover-titles.js
echo "✅ Complete"
