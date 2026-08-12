# Call Agent Dashboard

Standalone static dashboard for tracking call-agent activity from a Google Sheet.

## Data source

The app reads this sheet as CSV:

`https://docs.google.com/spreadsheets/d/19NMJyjtPNBEqm_STpbVeO69UbymsL7F78h5uX_7xeE8`

The dashboard automatically maps common column names for:

- agent
- shop
- task type
- timestamp, or date plus time

If the dashboard cannot map a required date/time field, it shows an error with the missing mapping.

## Run locally

From this folder:

```powershell
python -m http.server 8000
```

Then open:

`http://localhost:8000`

Opening `index.html` directly may work, but a local server is more reliable for browser `fetch()` requests.
