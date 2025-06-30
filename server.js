const express = require('express');
const bodyParser = require('body-parser');
const dayjs = require('dayjs');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ==== MIDDLEWARE ====
// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://zevana.co',
      'https://www.zevana.co',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
}));

// Handle preflight requests
app.options('*', cors());

// Additional CORS headers middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', true);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/track', limiter);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// ==== SHOPIFY CONFIG ====
const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Validate required environment variables
if (!SHOPIFY_SHOP || !SHOPIFY_TOKEN) {
  console.error('Missing required environment variables: SHOPIFY_SHOP and SHOPIFY_ACCESS_TOKEN');
  process.exit(1);
}

// ==== VALIDATION HELPERS ====
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateOrderNumber(orderNumber) {
  // Allow alphanumeric characters, hyphens, and underscores
  const orderRegex = /^[a-zA-Z0-9\-_#]+$/;
  return orderRegex.test(orderNumber) && orderNumber.length >= 1 && orderNumber.length <= 50;
}

// ==== HELPER TO GET ORDER ====
async function getOrder(orderNumber, email) {
  try {
    // Search orders by name (order number, e.g. "#12345")
    // Shopify order name is usually "#12345", so prepend "#" if not present
    const name = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;

    // REST API: List Orders with search filter (name/email) - include fulfillment_status and financial_status
    const url = `https://${SHOPIFY_SHOP}/admin/api/2024-04/orders.json?status=any&fields=id,name,email,created_at,fulfillments,fulfillment_status,financial_status,closed_at&name=${encodeURIComponent(name)}`;

    const res = await axios.get(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });

    // Orders can be multiple if customer used same order number, filter by email too
    const orders = res.data.orders || [];
    const order = orders.find(o => o.email && o.email.toLowerCase() === email.toLowerCase()) || orders[0];

    return order;
  } catch (error) {
    console.error('Error fetching order from Shopify:', error.message);
    throw error;
  }
}

// ==== ORDER STATUS LOGIC ====
function determineOrderStatus(order) {
  // Check if order is delivered (closed_at is set when order is delivered)
  if (order.closed_at) {
    return {
      status: 'Order Delivered',
      trackingNumber: null,
      deliveredAt: order.closed_at
    };
  }

  // Check if tracking is added
  const fulfillment = (order.fulfillments && order.fulfillments.length > 0) ? order.fulfillments[0] : null;
  const trackingNumber = fulfillment && fulfillment.tracking_number ? fulfillment.tracking_number : null;

  if (trackingNumber) {
    return {
      status: 'In Transit',
      trackingNumber: trackingNumber,
      deliveredAt: null
    };
  }

  // Calculate hours since order was placed
  const hours = dayjs().diff(dayjs(order.created_at), 'hour');
  
  if (hours < 48) {
    return {
      status: 'Order Processing',
      trackingNumber: null,
      deliveredAt: null
    };
  } else {
    return {
      status: 'In Transit',
      trackingNumber: null,
      deliveredAt: null
    };
  }
}

// ==== HEALTH CHECK ENDPOINT ====
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ==== TRACKING ENDPOINT ====
app.post('/track', async (req, res) => {
  try {
    const { orderNumber, email } = req.body;

    // Input validation
    if (!orderNumber || !email) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Both orderNumber and email are required',
        code: 'MISSING_FIELDS'
      });
    }

    if (!validateOrderNumber(orderNumber)) {
      return res.status(400).json({
        error: 'Invalid order number',
        message: 'Order number must be 1-50 characters and contain only letters, numbers, hyphens, underscores, and #',
        code: 'INVALID_ORDER_NUMBER'
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email address',
        message: 'Please provide a valid email address',
        code: 'INVALID_EMAIL'
      });
    }

    const order = await getOrder(orderNumber, email);
    
    if (!order) {
      return res.status(404).json({
        error: 'Order not found',
        message: 'No order found with the provided order number and email',
        code: 'ORDER_NOT_FOUND'
      });
    }

    const statusInfo = determineOrderStatus(order);

    res.json({
      success: true,
      data: {
        orderNumber: order.name.replace('#', ''),
        status: statusInfo.status,
        trackingNumber: statusInfo.trackingNumber,
        orderDate: order.created_at,
        lastUpdated: new Date().toISOString(),
        deliveredAt: statusInfo.deliveredAt
      }
    });

  } catch (error) {
    console.error('Error in /track endpoint:', error.message);
    
    // Handle specific Shopify API errors
    if (error.response) {
      const status = error.response.status;
      if (status === 401) {
        return res.status(500).json({
          error: 'Authentication failed',
          message: 'Shopify API authentication error',
          code: 'SHOPIFY_AUTH_ERROR'
        });
      } else if (status === 403) {
        return res.status(500).json({
          error: 'Access denied',
          message: 'Shopify API access denied',
          code: 'SHOPIFY_ACCESS_DENIED'
        });
      } else if (status >= 500) {
        return res.status(503).json({
          error: 'Service unavailable',
          message: 'Shopify API is currently unavailable',
          code: 'SHOPIFY_SERVICE_UNAVAILABLE'
        });
      }
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing your request',
      code: 'INTERNAL_ERROR'
    });
  }
});

// ==== 404 HANDLER ====
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.method} ${req.originalUrl} does not exist`,
    code: 'ENDPOINT_NOT_FOUND'
  });
});

// ==== ERROR HANDLER ====
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred',
    code: 'UNHANDLED_ERROR'
  });
});

// ==== SERVER STARTUP ====
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.listen(PORT, () => {
  console.log(`🚀 Tracking API running on port ${PORT}`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`📊 Health check available at: http://localhost:${PORT}/health`);
  console.log(`📦 Tracking endpoint: http://localhost:${PORT}/track`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
