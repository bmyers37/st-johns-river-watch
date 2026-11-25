# St. Johns River Watch

A dashboard for river gauges, rainfall, drainage infrastructure and official weather alerts in Florida's St. Johns River basin.

## Download for Windows

Download the 64-bit Windows executable from the [latest GitHub release](https://github.com/bmyers37/st-johns-river-watch/releases/latest). Double-click it to open the dashboard in your browser. The executable includes Node.js, and live data and map tiles require an internet connection. Close the console window to stop the server.

See the [app guide](app/README.md) for features, data sources and coverage limits.

## Run from source

Use Node.js 24 and npm.

```sh
cd app
npm ci
npm run build
npm start
```

Open http://127.0.0.1:5179. The server listens on loopback by default.

## Self-host

The Node service serves the built site and its same-origin data API. It keeps its cache in memory and needs outbound HTTPS access to public data sources. It requires no database.

| Setting | Value |
| --- | --- |
| Service type | Node web service |
| Root directory | `app` |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Node version | 24 (pinned in `app/.node-version`) |
| Environment variable | `HOST=0.0.0.0` |
| Port | Set `PORT` if your host does not supply it |
| Health check path | `/api/health` |

After deploying, open the HTTPS site and check the map, source status, station history and alerts. The health endpoint checks the web process. Live data availability is shown in the dashboard.
