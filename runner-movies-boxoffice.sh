#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "🎬 Discover: Movies (Box Office)"
DISCOVER_URL="https://pro.imdb.com/discover/title?sortOrder=BOX_OFFICE_GROSS_DESC&ref_=hm_nv_tt_tmm&type=movie" DISCOVER_START_PAGE=1 DISCOVER_MAX_PAGES=100 node imdbpro-discover-titles.js
echo "✅ Complete"
