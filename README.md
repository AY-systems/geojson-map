pmtitles を作成するコマンド例：

```sh
tippecanoe -o japan_municipalities.pmtiles   --layer=municipalities   -Z4 -z14   ./N03-20240101.geojson
```

geojson の前処理

```sh
mapshaper N03-xxxxxx.geojson   -filter 'N03_001 != "47"'   -simplify 10% keep-shapes   -explode   -sort 'this.area' descending   -uniq N03_007   -o output.geojson format=geojson
```
