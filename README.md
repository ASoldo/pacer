# Pacer

Vue 3 rally pacing PWA with high-contrast map tiles, OSRM routing, Web Speech API/Piper co-driver calls, GPS drive mode, simulator shakedown, vehicle inventory, HTTPS dev serving, and PWA install support.

Vehicle inventory starts with a VIN-derived profile, keeps owner modifications layered on top, and is designed to match the active car later through OBD2 adapter discovery. See `docs/vehicle-inventory.md`.

## Run

```sh
npm install
npm run dev
```

The dev command starts Vite over HTTPS plus the local `/api/tts` server. Browser speech is tried first; if Chrome reports `synthesis-failed`, the app falls back to Piper using the local male `en_US-ryan-high` voice.

## Environment

```sh
VITE_OSRM_BASE_URL=https://router.project-osrm.org
VITE_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
VITE_MAP_SUBDOMAINS=
VITE_MAP_MAX_ZOOM=19
VITE_MAP_ATTRIBUTION="&copy; OpenStreetMap contributors"
PIPER_MODEL=/home/rootster/documents/codex/Automation/models/piper/en_US-ryan-high.onnx
PIPER_CONFIG=/home/rootster/documents/codex/Automation/models/piper/en_US-ryan-high.onnx.json
```

Use a self-hosted OSRM URL in k3s when you want private routing or no public demo-service limits.
The default map uses labeled OpenStreetMap tiles so street names stay visible during recce and simulation. For production k3s hosting, prefer a self-hosted vector stack such as OpenFreeMap, OpenMapTiles, or Protomaps and point `VITE_MAP_TILE_URL` at your internal tile endpoint.

- `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png` for a quieter labeled raster style when you have the right hosted-tile permissions.
- `https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png` for a pure road-shape driving surface with no labels.
- `https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png` for night/low-glare driving.
- `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png` for a quiet light map.

## Build

```sh
npm run build
```

## Container

```sh
docker build -t pacer:latest .
```

Update `k8s/rally-pacenotes.yaml` with your registry image and VPN hostname, then apply it to the cluster.
