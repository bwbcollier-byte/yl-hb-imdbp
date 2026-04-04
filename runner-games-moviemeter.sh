#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "🎮 Discover: Games (Moviemeter)"
DISCOVER_URL="https://pro.imdb.com/discover/title?sortOrder=MOVIEMETER_ASC&ref_=hm_nv_tt_tmm&type=videoGame" DISCOVER_START_PAGE=1 DISCOVER_MAX_PAGES=50 node imdbpro-discover-titles.js
echo "✅ Complete"
