# Natural Earth land

Fonte: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
Dati di pubblico dominio: https://www.naturalearthdata.com/about/terms-of-use/
SHA-256: 9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9

Il GeoJSON originale è conservato per rendere riproducibile la rasterizzazione. Eseguire node scripts/build-world-map.mjs per aggiornare packages/engine/src/world-land.ts. Proiezione equirettangolare globale, 512×256 tile, rasterizzata al centro del tile con regola pari/dispari per gli anelli interni. Le coste derivano dai poligoni; altitudine/difficoltà del terreno sono valori di gioco procedurali e non un modello digitale di elevazione reale. Nessuna richiesta di rete durante la partita.
