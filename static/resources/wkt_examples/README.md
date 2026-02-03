WKT examples for CSV uploads

These example CSV files show how to include WKT geometries when uploading CSV files via the manual upload UI.

Accepted geometry column names (case-insensitive):
- wkt
- geometry
- wgs84wkt
- geometry_wkt
- geom
- geom_wkt

Examples provided:
- `points_wkt.csv` — multiple POINT geometries in a `wkt` column
- `polygons_wkt.csv` — POLYGON geometries in a `wkt` column
- `linestrings_wkt.csv` — LINESTRING geometries in a `wkt` column
- `mixed_wkt.csv` — mixed geometry types in a `geometry` column (also demonstrates MULTIPOLYGON)

Notes:
- WKT strings must be valid and use WGS84 coordinates (lon lat).
- When a WKT column is present it will be used in preference to separate latitude/longitude columns.
- Malformed WKT or rows without valid geometry will be skipped by the uploader.

If you want, I can add these as example downloads in the UI or link them from the upload help text.