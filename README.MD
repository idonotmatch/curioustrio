Curious Trio is currently pre-launch. We're building a service aimed at changing the way people approach product research and discover online. #curioustrio

## Local dev

The mobile app talks to the API server. For local simulator work, start both:

```bash
npm run dev:api
npm run dev:mobile
```

Expected local defaults:
- API: `http://127.0.0.1:3002`
- Gmail OAuth callback: `http://localhost:3002/gmail/callback`

Useful setup notes:
- Copy [api/.env.example](/Users/dangnguyen/curious-trio/api/.env.example) to `api/.env` and fill in secrets.
- Copy [mobile/.env.example](/Users/dangnguyen/curious-trio/mobile/.env.example) to `mobile/.env` if you want to pin a local API URL.
- If `EXPO_PUBLIC_API_URL` is unset, the mobile client will try local `3001` and `3002`.
