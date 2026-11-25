# St. Johns River Watch

A dashboard for river gauges, rainfall, drainage infrastructure and official weather alerts in Florida's St. Johns River basin. See the [app guide](app/README.md) for features, data sources, map attribution and the Windows launchers.

## Run locally

Use Node.js 24 and npm.

```sh
cd app
npm ci
npm run build
npm start
```

Open http://127.0.0.1:5179. The server listens on loopback by default. GitHub Actions checks the production build on pushes and pull requests.

## Deploy a preview

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

## Public release

- Move the USGS live values, history, rainfall and site metadata off the legacy WaterServices endpoints before relying on the dashboard for a public launch. USGS will retire those endpoints on February 22, 2027. [USGS shutdown notice](https://waterservices.usgs.gov/)
- Verify that the deployed map and data feeds work from the host and that their usage terms cover the public deployment. The app guide lists the upstream providers.
- Choose a source license if you want to grant others permission to reuse the code.

## Hosting options

- **Render** is the simplest fit for the current app. Use a free Web Service for a preview or Starter compute at $7/month for an always-on launch. Free services sleep after 15 minutes without inbound traffic. [Deploy guide](https://render.com/docs/your-first-deploy) · [Pricing](https://render.com/pricing) · [Free tier](https://render.com/docs/free)
- **Railway** can run the same Node service with `/app` as the service root. Hobby starts at $5/month and includes $5 in resource usage. Extra usage is billed separately. [Monorepo guide](https://docs.railway.com/deployments/monorepo) · [Pricing](https://docs.railway.com/pricing/plans)
- **Fly.io** offers regional virtual machines and usage-based pricing. This route would need a container build and a Fly configuration. [Pricing](https://fly.io/docs/about/pricing/)
- **GitHub Pages** can host static files. River Watch would still need a separate host for its Node API. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
