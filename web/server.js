import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const sessionsFile = path.join(dataDir, 'sessions.json');
const stateStore = new Map();

const config = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecret: process.env.SHOPIFY_API_SECRET,
  appUrl: process.env.APP_URL || railwayAppUrl(),
  scopes: process.env.SCOPES || 'read_orders',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
  port: Number(process.env.PORT || 3000),
};

assertConfig();

const app = express();
app.use(express.json({limit: '1mb'}));
app.use(cors);

app.get('/', (_req, res) => {
  res.type('html').send(`
    <main style="font-family: system-ui, sans-serif; max-width: 760px; margin: 48px auto; line-height: 1.5;">
      <h1>Track Order Hub</h1>
      <p>This Shopify app adds an order tracking block to the Customer Accounts order status page.</p>
      <p>Install path: <code>/auth?shop=your-store.myshopify.com</code></p>
    </main>
  `);
});

app.get('/healthz', (_req, res) => {
  res.json({ok: true});
});

app.get('/auth', (req, res) => {
  const shop = normalizeShop(req.query.shop);

  if (!shop) {
    res.status(400).send('Missing or invalid shop parameter. Use /auth?shop=your-store.myshopify.com');
    return;
  }

  const state = crypto.randomBytes(24).toString('hex');
  stateStore.set(state, Date.now());

  const redirectUri = `${config.appUrl}/auth/callback`;
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set('client_id', config.apiKey);
  authUrl.searchParams.set('scope', config.scopes);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  res.redirect(authUrl.toString());
});

app.get('/auth/callback', async (req, res) => {
  try {
    const shop = normalizeShop(req.query.shop);
    const {code, state} = req.query;

    if (!shop || typeof code !== 'string' || typeof state !== 'string') {
      res.status(400).send('Invalid OAuth callback.');
      return;
    }

    if (!stateStore.has(state)) {
      res.status(403).send('Invalid OAuth state.');
      return;
    }

    stateStore.delete(state);

    if (!verifyShopifyHmac(req.query)) {
      res.status(403).send('Invalid OAuth HMAC.');
      return;
    }

    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        client_id: config.apiKey,
        client_secret: config.apiSecret,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      res.status(502).send('Could not exchange OAuth code for an access token.');
      return;
    }

    const shopMetadata = await fetchShopMetadata(shop, tokenData.access_token);
    const sessionStore = await readSessionStore();

    sessionStore.shops[shop] = {
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
      shopId: shopMetadata.id,
      shopLegacyId: shopMetadata.legacyId,
      myshopifyDomain: shopMetadata.myshopifyDomain || shop,
      name: shopMetadata.name,
      installedAt: new Date().toISOString(),
    };

    if (shopMetadata.id) sessionStore.shopIds[shopMetadata.id] = shop;
    if (shopMetadata.legacyId) sessionStore.shopLegacyIds[shopMetadata.legacyId] = shop;

    await writeSessionStore(sessionStore);

    res.type('html').send(`
      <main style="font-family: system-ui, sans-serif; max-width: 760px; margin: 48px auto; line-height: 1.5;">
        <h1>Track Order Hub installed</h1>
        <p>The app is installed for <strong>${escapeHtml(shop)}</strong>.</p>
        <p>Next, open Shopify Admin &gt; Settings &gt; Checkout &gt; Customize, then add the <strong>Track order block</strong> app block to the Order status page.</p>
      </main>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('Installation failed.');
  }
});

app.post('/api/order-tracking', async (req, res) => {
  try {
    const token = readBearerToken(req);
    const payload = verifySessionToken(token);
    const shopIdentity = extractShopIdentityFromSessionToken(payload);
    const {orderId} = req.body || {};

    if (!shopIdentity.shop && !shopIdentity.shopId && !shopIdentity.shopLegacyId) {
      res.status(401).json({ok: false, error: 'Could not identify the shop for this request.'});
      return;
    }

    if (!isShopifyOrderGid(orderId)) {
      res.status(400).json({ok: false, error: 'Invalid order identifier.'});
      return;
    }

    const sessionStore = await readSessionStore();
    const shop = resolveShop(sessionStore, shopIdentity);
    const session = shop ? sessionStore.shops[shop] : null;

    if (!session?.accessToken) {
      res.status(401).json({ok: false, error: 'App is not installed for this store.'});
      return;
    }

    const tracking = await fetchOrderTracking(shop, session.accessToken, orderId);
    res.json({ok: true, ...tracking});
  } catch (error) {
    console.error(error);
    res.status(401).json({ok: false, error: 'Tracking request could not be authenticated.'});
  }
});

app.post('/webhooks', (_req, res) => {
  res.status(200).send('ok');
});

app.listen(config.port, () => {
  console.log(`Track Order Hub listening on ${config.port}`);
});

async function fetchShopMetadata(shop, accessToken) {
  const query = `
    query ShopIdentity {
      shop {
        id
        name
        myshopifyDomain
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({query}),
  });

  const body = await response.json();

  if (!response.ok || body.errors) {
    return {
      id: '',
      legacyId: '',
      myshopifyDomain: shop,
      name: '',
    };
  }

  const id = body.data?.shop?.id || '';

  return {
    id,
    legacyId: extractGidNumber(id),
    myshopifyDomain: body.data?.shop?.myshopifyDomain || shop,
    name: body.data?.shop?.name || '',
  };
}

async function fetchOrderTracking(shop, accessToken, orderId) {
  const query = `
    query TrackOrder($id: ID!) {
      order(id: $id) {
        id
        name
        processedAt
        cancelledAt
        displayFulfillmentStatus
        statusPageUrl
        fulfillments {
          id
          name
          status
          displayStatus
          createdAt
          inTransitAt
          deliveredAt
          estimatedDeliveryAt
          totalQuantity
          trackingInfo(first: 10) {
            company
            number
            url
          }
          fulfillmentLineItems(first: 10) {
            nodes {
              quantity
              lineItem {
                title
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/admin/api/${config.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({
      query,
      variables: {id: orderId},
    }),
  });

  const body = await response.json();

  if (!response.ok || body.errors) {
    throw new Error(`Admin API order tracking query failed: ${JSON.stringify(body.errors || body)}`);
  }

  const order = body.data?.order;

  if (!order) {
    return {
      order: null,
      shipments: [],
    };
  }

  return {
    order: {
      id: order.id,
      name: order.name,
      processedAt: order.processedAt,
      cancelledAt: order.cancelledAt,
      fulfillmentStatus: order.displayFulfillmentStatus,
      statusPageUrl: order.statusPageUrl,
    },
    shipments: (order.fulfillments || []).map((fulfillment) => ({
      id: fulfillment.id,
      name: fulfillment.name,
      status: fulfillment.status,
      displayStatus: fulfillment.displayStatus,
      createdAt: fulfillment.createdAt,
      inTransitAt: fulfillment.inTransitAt,
      deliveredAt: fulfillment.deliveredAt,
      estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
      totalQuantity: fulfillment.totalQuantity,
      tracking: (fulfillment.trackingInfo || []).map((item) => ({
        company: item.company,
        number: item.number,
        url: item.url,
      })),
      items: (fulfillment.fulfillmentLineItems?.nodes || []).map((item) => ({
        title: item.lineItem?.title,
        quantity: item.quantity,
      })),
    })),
  };
}

function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  next();
}

function verifyShopifyHmac(query) {
  const {hmac} = query;
  if (typeof hmac !== 'string') return false;

  const message = Object.keys(query)
    .filter((key) => key !== 'hmac' && key !== 'signature')
    .sort()
    .map((key) => `${key}=${Array.isArray(query[key]) ? query[key].join(',') : query[key]}`)
    .join('&');

  const digest = crypto.createHmac('sha256', config.apiSecret).update(message).digest('hex');
  return safeEqual(digest, hmac);
}

function verifySessionToken(token) {
  if (!token) throw new Error('Missing session token');

  const [encodedHeader, encodedPayload, signature] = token.split('.');

  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error('Invalid session token');
  }

  const expectedSignature = base64Url(
    crypto.createHmac('sha256', config.apiSecret).update(`${encodedHeader}.${encodedPayload}`).digest(),
  );

  if (!safeEqual(expectedSignature, signature)) {
    throw new Error('Invalid session token signature');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);

  if (payload.exp && payload.exp < now) throw new Error('Session token expired');
  if (payload.nbf && payload.nbf > now) throw new Error('Session token is not active yet');
  if (payload.aud && payload.aud !== config.apiKey) throw new Error('Session token audience mismatch');

  return payload;
}

function extractShopIdentityFromSessionToken(payload) {
  const identity = {
    shop: '',
    shopId: '',
    shopLegacyId: '',
  };

  const sources = [payload.dest, payload.iss, payload.shop].filter((source) => typeof source === 'string');

  for (const source of sources) {
    const normalizedShop = normalizeShopFromUrlOrDomain(source);
    if (normalizedShop) identity.shop = normalizedShop;

    const legacyId = extractShopLegacyId(source);
    if (legacyId) {
      identity.shopLegacyId = legacyId;
      identity.shopId = `gid://shopify/Shop/${legacyId}`;
    }
  }

  return identity;
}

function extractShopLegacyId(source) {
  const text = String(source || '');
  const match = text.match(/shopify\.com\/(\d+)(?:[/?#]|$)/) || text.match(/\/Shop\/(\d+)(?:[/?#]|$)/);
  return match ? match[1] : '';
}

function normalizeShopFromUrlOrDomain(source) {
  if (typeof source !== 'string') return '';

  try {
    const hostname = source.startsWith('http') ? new URL(source).hostname : source;
    return normalizeShop(hostname);
  } catch (_error) {
    return normalizeShop(source);
  }
}

function resolveShop(sessionStore, identity) {
  if (identity.shop && sessionStore.shops[identity.shop]) return identity.shop;
  if (identity.shopId && sessionStore.shopIds[identity.shopId]) return sessionStore.shopIds[identity.shopId];
  if (identity.shopLegacyId && sessionStore.shopLegacyIds[identity.shopLegacyId]) {
    return sessionStore.shopLegacyIds[identity.shopLegacyId];
  }

  return '';
}

function readBearerToken(req) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function normalizeShop(value) {
  if (typeof value !== 'string') return '';
  const shop = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? shop : '';
}

function isShopifyOrderGid(value) {
  return typeof value === 'string' && /^gid:\/\/shopify\/Order\/\d+$/.test(value);
}

async function readSessionStore() {
  try {
    const raw = await fs.readFile(sessionsFile, 'utf8');
    return normalizeSessionStore(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeSessionStore({});
    throw error;
  }
}

async function writeSessionStore(sessionStore) {
  await fs.mkdir(dataDir, {recursive: true});
  await fs.writeFile(sessionsFile, `${JSON.stringify(normalizeSessionStore(sessionStore), null, 2)}\n`);
}

function normalizeSessionStore(value) {
  if (value?.shops) {
    return {
      shops: value.shops || {},
      shopIds: value.shopIds || {},
      shopLegacyIds: value.shopLegacyIds || {},
    };
  }

  return {
    shops: value || {},
    shopIds: {},
    shopLegacyIds: {},
  };
}

function extractGidNumber(gid) {
  const match = String(gid || '').match(/\/(\d+)$/);
  return match ? match[1] : '';
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function assertConfig() {
  const missing = Object.entries({
    SHOPIFY_API_KEY: config.apiKey,
    SHOPIFY_API_SECRET: config.apiSecret,
    APP_URL: config.appUrl,
  })
    .filter(([, value]) => !value || String(value).includes('replace_with'))
    .map(([key]) => key);

  if (missing.length) {
    console.warn(`Missing app config: ${missing.join(', ')}. Copy .env.example to .env before running the server.`);
  }
}

function railwayAppUrl() {
  if (!process.env.RAILWAY_PUBLIC_DOMAIN) return '';
  return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}
