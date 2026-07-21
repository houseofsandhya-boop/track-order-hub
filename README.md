# Track Order Hub

Reusable Shopify app starter for adding a tracking block to the new Customer Accounts order status page.

## What this app does

- Adds a **Track order block** app block for `customer-account.order-status.block.render`.
- Reads the current order ID from the Customer Account Order API.
- Calls this app backend with a Shopify session token.
- Backend verifies the token, uses the merchant's installed Admin API token, and reads fulfillment tracking from Shopify Admin GraphQL.

## Distribution reality

For one store, a custom app install link is fine. For multiple unrelated merchants, Shopify requires a public app path. You can keep the app unlisted, but it still needs Shopify app review before many merchants can install it.

## Setup

1. Create a Shopify Partner app.
2. Copy `.env.example` to `.env` and fill in:
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`
   - `APP_URL`
3. Update `shopify.app.toml`:
   - `client_id`
   - `application_url`
   - `auth.redirect_urls`
4. Update `extensions/order-tracking-block/src/OrderTrackingBlock.jsx` if the Railway domain changes:
   - Current API endpoint: `https://track-order-hub-production.up.railway.app/api/order-tracking`
5. Install dependencies:

```bash
npm install
```

6. Link this local project to your Partner app:

```bash
shopify app config link
```

7. Start development:

```bash
npm run dev
```

8. Deploy extensions:

```bash
npm run deploy
```

## Merchant install flow

After the app is hosted and deployed, install it on a store with:

```text
https://track-order-hub-production.up.railway.app/auth?shop=store-name.myshopify.com
```

Then in Shopify Admin:

```text
Settings > Checkout > Customize > Order status > Add block > Track order block
```

## GitHub and Railway deploy

Railway should deploy this repo from GitHub. The backend runs with `npm start`, listens on Railway's `PORT`, and exposes `/healthz` for health checks.

Set these Railway environment variables:

```text
SHOPIFY_API_KEY=your_shopify_partner_app_client_id
SHOPIFY_API_SECRET=your_shopify_partner_app_client_secret
APP_URL=https://track-order-hub-production.up.railway.app
SCOPES=read_orders
SHOPIFY_API_VERSION=2026-07
```

If `APP_URL` is not set, the backend tries to use Railway's `RAILWAY_PUBLIC_DOMAIN`, but Shopify Partner app settings still need the final production URL.

Railway live URL:

```text
https://track-order-hub-production.up.railway.app
```

If Railway gives you a different live URL later:

1. Update `shopify.app.toml` with the live URL and callback.
2. Update `extensions/order-tracking-block/src/OrderTrackingBlock.jsx` so `API_ENDPOINT` uses the live URL.
3. Run `npm run deploy` to deploy the Shopify customer account extension.

## Production notes

- Replace the JSON session store with a real database.
- Encrypt offline access tokens at rest.
- Request `network_access` for the customer account extension in the Partner Dashboard.
- If you need orders older than 60 days, request Shopify's `read_all_orders` access.
- Keep requested scopes minimal. This starter uses `read_orders` because fulfillment tracking is order data.
