# Serving

`server.js` exports `createApp`, `start`, `CSP`, `DEFAULT_PORT`. Middleware order is fixed: `/health` → JSON body parser → `/api` (404 JSON until routes exist) → CSP header → `express.static(frontend/dist)`. If `frontend/dist/index.html` is missing, everything after `/api` answers 503 "UI not built". Binding is always `127.0.0.1`. Running the file directly starts it; importing it does not.
