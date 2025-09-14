# Shopify Tracking API (Cloudflare Worker)

A production-ready REST API for tracking Shopify orders built as a Cloudflare Worker with enhanced security, validation, and error handling.

## 🚀 Features

- **Order Tracking**: Search orders by order number and email
- **Smart Status Logic**: Automatic status determination based on fulfillment and time
- **Rate Limiting**: Protection against abuse (100 requests per 15 minutes per IP)
- **Input Validation**: Comprehensive validation for all inputs
- **Error Handling**: Detailed error responses with error codes
- **Health Monitoring**: Built-in health check endpoint
- **Global Edge Network**: Lightning-fast responses from Cloudflare's global CDN
- **Zero Cold Starts**: Instant execution with Cloudflare Workers
- **Cost Effective**: Pay-per-request pricing model

## 📋 Prerequisites

- Node.js 18+ 
- npm 8+
- Cloudflare account
- Wrangler CLI (installed automatically with npm install)
- Shopify store with API access
- Shopify access token with orders read permission

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd shopify-order-tracking
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Cloudflare secrets**
   ```bash
   # Set your Shopify store domain
   wrangler secret put SHOPIFY_SHOP
   # Enter: your-store.myshopify.com
   
   # Set your Shopify access token
   wrangler secret put SHOPIFY_ACCESS_TOKEN
   # Enter: shpat_your_access_token_here
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Deploy to Cloudflare**
   ```bash
   # Deploy to development environment
   npm run deploy
   
   # Deploy to production environment
   npm run deploy:prod
   ```

## 🌐 API Endpoints

### Health Check
```
GET /health
```
Returns server health status and uptime information.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "environment": "production"
}
```

### Track Order
```
POST /track
```

**Request Body:**
```json
{
  "orderNumber": "12345",
  "email": "customer@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "orderNumber": "12345",
    "status": "In Transit",
    "trackingNumber": "1Z999AA1234567890",
    "orderDate": "2024-01-10T15:30:00.000Z",
    "lastUpdated": "2024-01-15T10:30:00.000Z",
    "deliveredAt": null
  }
}
```

**Example Responses for Different Statuses:**

**Order Processing:**
```json
{
  "success": true,
  "data": {
    "orderNumber": "12345",
    "status": "Order Processing",
    "trackingNumber": null,
    "orderDate": "2024-01-15T08:00:00.000Z",
    "lastUpdated": "2024-01-15T10:30:00.000Z",
    "deliveredAt": null
  }
}
```

**Order Delivered:**
```json
{
  "success": true,
  "data": {
    "orderNumber": "12345",
    "status": "Order Delivered",
    "trackingNumber": "1Z999AA1234567890",
    "orderDate": "2024-01-10T15:30:00.000Z",
    "lastUpdated": "2024-01-15T10:30:00.000Z",
    "deliveredAt": "2024-01-14T16:45:00.000Z"
  }
}
```

**Error Responses:**

**400 - Bad Request:**
```json
{
  "error": "Invalid email address",
  "message": "Please provide a valid email address",
  "code": "INVALID_EMAIL"
}
```

**404 - Order Not Found:**
```json
{
  "error": "Order not found",
  "message": "No order found with the provided order number and email",
  "code": "ORDER_NOT_FOUND"
}
```

**429 - Rate Limited:**
```json
{
  "error": "Too many requests from this IP, please try again later.",
  "retryAfter": "15 minutes"
}
```

## 📊 Order Status Logic

The API determines order status based on the following rules:

1. **"Order Processing"**: 
   - Order is less than 48 hours old
   - No tracking number has been added yet
   - Order is still being prepared for shipment

2. **"In Transit"**: 
   - Order is older than 48 hours OR tracking number has been added
   - Shows tracking number when available
   - Order is being shipped to customer

3. **"Order Delivered"**: 
   - Order has been marked as delivered in Shopify (closed_at is set)
   - Final status indicating successful delivery

**Status Flow:**
```
Order Placed → Order Processing (0-48h) → In Transit → Order Delivered
```

**Response includes:**
- `status`: Current order status
- `trackingNumber`: Tracking number (if available)
- `orderDate`: When order was placed
- `deliveredAt`: Delivery date (if delivered)
- `lastUpdated`: API response timestamp

## 🚀 Deployment on Cloudflare Workers

### Automatic Deployment

1. **Push your code to GitHub**
2. **Connect your repository to Cloudflare Pages/Workers**
3. **Cloudflare will automatically detect the `wrangler.toml` file**
4. **Set secrets using Wrangler CLI:**
   ```bash
   wrangler secret put SHOPIFY_SHOP
   wrangler secret put SHOPIFY_ACCESS_TOKEN
   ```

### Manual Deployment

1. **Install Wrangler CLI** (if not already installed)
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**
   ```bash
   wrangler login
   ```

3. **Set secrets**
   ```bash
   wrangler secret put SHOPIFY_SHOP
   wrangler secret put SHOPIFY_ACCESS_TOKEN
   ```

4. **Deploy the worker**
   ```bash
   wrangler deploy
   ```

5. **Your API will be available at**: `https://shopify-tracking-api.your-subdomain.workers.dev`

## 🔧 Environment Variables (Cloudflare Secrets)

| Variable | Description | Required | Example | How to Set |
|----------|-------------|----------|---------|------------|
| `SHOPIFY_SHOP` | Your Shopify store domain | Yes | `your-store.myshopify.com` | `wrangler secret put SHOPIFY_SHOP` |
| `SHOPIFY_ACCESS_TOKEN` | Shopify API access token | Yes | `shpat_...` | `wrangler secret put SHOPIFY_ACCESS_TOKEN` |

**Note**: Environment variables in Cloudflare Workers are set as secrets for security. Use `wrangler secret put` to set them.

## 🛡️ Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Input Validation**: Comprehensive validation for all inputs
- **Error Handling**: No sensitive information leaked in errors
- **Request Logging**: All requests are logged with timestamps
- **Graceful Shutdown**: Proper handling of SIGTERM/SIGINT signals

## 📝 Error Codes

| Code | Description |
|------|-------------|
| `MISSING_FIELDS` | Required fields are missing |
| `INVALID_ORDER_NUMBER` | Order number format is invalid |
| `INVALID_EMAIL` | Email format is invalid |
| `ORDER_NOT_FOUND` | No order found with provided details |
| `SHOPIFY_AUTH_ERROR` | Shopify API authentication failed |
| `SHOPIFY_ACCESS_DENIED` | Shopify API access denied |
| `SHOPIFY_SERVICE_UNAVAILABLE` | Shopify API is unavailable |
| `INTERNAL_ERROR` | Unexpected server error |
| `ENDPOINT_NOT_FOUND` | Requested endpoint doesn't exist |

## 🔍 Testing

Test the API using curl or any HTTP client:

```bash
# Health check
curl https://shopify-tracking-api.your-subdomain.workers.dev/health

# Track order
curl -X POST https://shopify-tracking-api.your-subdomain.workers.dev/track \
  -H "Content-Type: application/json" \
  -d '{
    "orderNumber": "12345",
    "email": "customer@example.com"
  }'
```

**Local Development:**
```bash
# Start local development server
npm run dev

# Test locally
curl http://localhost:8787/health
```

## 📈 Monitoring

The API includes built-in monitoring capabilities:

- **Health Check**: `/health` endpoint for uptime monitoring
- **Request Logging**: All requests logged with timestamps and IP addresses
- **Error Logging**: Detailed error logging for debugging
- **Cloudflare Analytics**: Built-in analytics and monitoring via Cloudflare dashboard
- **Global Performance**: Sub-50ms response times from edge locations worldwide

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 🆚 Cloudflare Workers vs Traditional Server

| Feature | Cloudflare Workers | Traditional Server |
|---------|-------------------|-------------------|
| **Cold Start** | None (instant) | 100-500ms |
| **Global Distribution** | 300+ locations | Single region |
| **Scaling** | Automatic | Manual configuration |
| **Cost** | Pay-per-request | Always-on pricing |
| **Maintenance** | Zero | Server management required |
| **Performance** | Sub-50ms globally | 100-300ms typical |

## 📄 License

This project is licensed under the MIT License. 