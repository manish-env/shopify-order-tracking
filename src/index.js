import dayjs from 'dayjs';

// ==== UTILITY FUNCTIONS ====

// CORS helper
function handleCORS(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = [
    'https://zevana.co',
    'https://www.zevana.co',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001'
  ];

  const corsHeaders = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (origin && allowedOrigins.includes(origin)) {
    corsHeaders['Access-Control-Allow-Origin'] = origin;
  } else if (!origin) {
    // Allow requests with no origin (like curl requests)
    corsHeaders['Access-Control-Allow-Origin'] = '*';
  }

  return corsHeaders;
}

// Response helpers
function createResponse(data, status = 200, headers = {}) {
  const corsHeaders = handleCORS(new Request('http://localhost'));
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...headers
    }
  });
}

function createErrorResponse(error, message, code, status = 400) {
  return createResponse({
    error,
    message,
    code
  }, status);
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

// ==== RATE LIMITING ====
class RateLimiter {
  constructor() {
    this.requests = new Map();
  }

  isAllowed(ip, maxRequests = 100, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!this.requests.has(ip)) {
      this.requests.set(ip, []);
    }

    const userRequests = this.requests.get(ip);
    
    // Remove old requests outside the window
    const validRequests = userRequests.filter(time => time > windowStart);
    this.requests.set(ip, validRequests);

    if (validRequests.length >= maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    return true;
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter();

// ==== SHOPIFY API HELPERS ====
async function getOrder(orderNumber, email, env) {
  try {
    let url;
    
    if (orderNumber && email) {
      // Both provided - search by order number and filter by email
      const name = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;
      url = `https://${env.SHOPIFY_SHOP}/admin/api/2024-04/orders.json?status=any&fields=id,name,email,created_at,fulfillments,fulfillment_status,financial_status,closed_at&name=${encodeURIComponent(name)}`;
    } else if (orderNumber) {
      // Only order number provided
      const name = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;
      url = `https://${env.SHOPIFY_SHOP}/admin/api/2024-04/orders.json?status=any&fields=id,name,email,created_at,fulfillments,fulfillment_status,financial_status,closed_at&name=${encodeURIComponent(name)}`;
    } else if (email) {
      // Only email provided
      url = `https://${env.SHOPIFY_SHOP}/admin/api/2024-04/orders.json?status=any&fields=id,name,email,created_at,fulfillments,fulfillment_status,financial_status,closed_at&email=${encodeURIComponent(email)}`;
    } else {
      throw new Error('Either orderNumber or email must be provided');
    }

    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();
    const orders = data.orders || [];
    
    if (orders.length === 0) {
      return null;
    }
    
    // If both orderNumber and email provided, find exact match
    if (orderNumber && email) {
      const order = orders.find(o => o.email && o.email.toLowerCase() === email.toLowerCase());
      return order || orders[0]; // Return first order if email doesn't match
    }
    
    // If only one field provided, return the most recent order
    return orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    
  } catch (error) {
    console.error('Error fetching order from Shopify:', error.message);
    throw error;
  }
}

// ==== ORDER STATUS LOGIC ====
function determineOrderStatus(order) {
  console.log('Processing order:', order.name);
  console.log('Fulfillments:', JSON.stringify(order.fulfillments, null, 2));
  
  // Check if tracking is added first (regardless of delivery status)
  const fulfillment = (order.fulfillments && order.fulfillments.length > 0) ? order.fulfillments[0] : null;
  console.log('First fulfillment:', fulfillment);
  
  // Try different ways to get tracking number
  let trackingNumber = null;
  if (fulfillment) {
    // Check for tracking_numbers array (Shopify's actual structure)
    if (fulfillment.tracking_numbers && fulfillment.tracking_numbers.length > 0) {
      trackingNumber = fulfillment.tracking_numbers[0];
      console.log('Tracking number from tracking_numbers array:', trackingNumber);
    }
    // Fallback to singular tracking_number
    else if (fulfillment.tracking_number) {
      trackingNumber = fulfillment.tracking_number;
      console.log('Tracking number from tracking_number field:', trackingNumber);
    }
    // Fallback to trackingNumber (camelCase)
    else if (fulfillment.trackingNumber) {
      trackingNumber = fulfillment.trackingNumber;
      console.log('Tracking number from trackingNumber field:', trackingNumber);
    }
    
    // Also check if there are any line items with tracking
    if (!trackingNumber && fulfillment.line_items) {
      for (const item of fulfillment.line_items) {
        if (item.tracking_number) {
          trackingNumber = item.tracking_number;
          console.log('Tracking number from line item:', trackingNumber);
          break;
        }
      }
    }
  }
  
  console.log('Final tracking number found:', trackingNumber);
  
  // Check if order is delivered (closed_at is set when order is delivered)
  if (order.closed_at) {
    console.log('Order is delivered');
    return {
      status: 'Order Delivered',
      trackingNumber: trackingNumber, // Return the tracking number even for delivered orders
      deliveredAt: order.closed_at
    };
  }

  if (trackingNumber) {
    console.log('Order has tracking number, status: In Transit');
    return {
      status: 'In Transit',
      trackingNumber: trackingNumber,
      deliveredAt: null
    };
  }

  // Calculate hours since order was placed
  const hours = dayjs().diff(dayjs(order.created_at), 'hour');
  console.log('Hours since order placed:', hours);
  
  if (hours < 48) {
    console.log('Order is processing (less than 48 hours)');
    return {
      status: 'Order Processing',
      trackingNumber: null,
      deliveredAt: null
    };
  } else {
    console.log('Order is in transit (more than 48 hours)');
    return {
      status: 'In Transit',
      trackingNumber: null,
      deliveredAt: null
    };
  }
}

// ==== ROUTE HANDLERS ====

// Health check endpoint
async function handleHealth() {
  return createResponse({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Date.now(), // Workers don't have process.uptime()
    environment: 'cloudflare-worker'
  });
}

// Debug endpoint
async function handleDebug(orderNumber, env) {
  try {
    const order = await getOrder(orderNumber, null, env);
    
    if (!order) {
      return createErrorResponse(
        'Order not found',
        `No order found with order number: ${orderNumber}`,
        'ORDER_NOT_FOUND',
        404
      );
    }
    
    return createResponse({
      success: true,
      order: {
        name: order.name,
        email: order.email,
        created_at: order.created_at,
        fulfillment_status: order.fulfillment_status,
        financial_status: order.financial_status,
        closed_at: order.closed_at,
        fulfillments: order.fulfillments,
        fulfillment_details: order.fulfillments ? order.fulfillments.map(f => ({
          id: f.id,
          tracking_numbers: f.tracking_numbers,
          tracking_urls: f.tracking_urls,
          tracking_company: f.tracking_company,
          tracking_number: f.tracking_number,
          trackingNumber: f.trackingNumber,
          status: f.status
        })) : []
      }
    });
    
  } catch (error) {
    console.error('Error in debug endpoint:', error.message);
    return createErrorResponse(
      'Internal server error',
      error.message,
      'INTERNAL_ERROR',
      500
    );
  }
}

// Main tracking endpoint
async function handleTrack(request, env) {
  try {
    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    if (!rateLimiter.isAllowed(clientIP)) {
      return createErrorResponse(
        'Too many requests from this IP, please try again later.',
        'Rate limit exceeded',
        'RATE_LIMIT_EXCEEDED',
        429
      );
    }

    const body = await request.json();
    const { orderNumber, email } = body;

    // Input validation - at least one field must be provided
    if (!orderNumber && !email) {
      return createErrorResponse(
        'Missing required fields',
        'Please provide either order number or email address',
        'MISSING_FIELDS'
      );
    }

    // Validate order number if provided
    if (orderNumber && !validateOrderNumber(orderNumber)) {
      return createErrorResponse(
        'Invalid order number',
        'Order number must be 1-50 characters and contain only letters, numbers, hyphens, underscores, and #',
        'INVALID_ORDER_NUMBER'
      );
    }

    // Validate email if provided
    if (email && !validateEmail(email)) {
      return createErrorResponse(
        'Invalid email address',
        'Please provide a valid email address',
        'INVALID_EMAIL'
      );
    }

    const order = await getOrder(orderNumber, email, env);
    
    if (!order) {
      const searchCriteria = [];
      if (orderNumber) searchCriteria.push('order number');
      if (email) searchCriteria.push('email');
      
      return createErrorResponse(
        'Order not found',
        `No order found with the provided ${searchCriteria.join(' and ')}`,
        'ORDER_NOT_FOUND',
        404
      );
    }

    const statusInfo = determineOrderStatus(order);
    
    console.log('Final status info:', statusInfo);
    console.log('API response data:', {
      orderNumber: order.name.replace('#', ''),
      status: statusInfo.status,
      trackingNumber: statusInfo.trackingNumber,
      orderDate: order.created_at,
      lastUpdated: new Date().toISOString(),
      deliveredAt: statusInfo.deliveredAt
    });

    return createResponse({
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
    if (error.message.includes('Shopify API error: 401')) {
      return createErrorResponse(
        'Authentication failed',
        'Shopify API authentication error',
        'SHOPIFY_AUTH_ERROR',
        500
      );
    } else if (error.message.includes('Shopify API error: 403')) {
      return createErrorResponse(
        'Access denied',
        'Shopify API access denied',
        'SHOPIFY_ACCESS_DENIED',
        500
      );
    } else if (error.message.includes('Shopify API error: 5')) {
      return createErrorResponse(
        'Service unavailable',
        'Shopify API is currently unavailable',
        'SHOPIFY_SERVICE_UNAVAILABLE',
        503
      );
    }

    return createErrorResponse(
      'Internal server error',
      'An unexpected error occurred while processing your request',
      'INTERNAL_ERROR',
      500
    );
  }
}

// ==== MAIN WORKER ====
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle preflight requests
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: handleCORS(request)
      });
    }

    // Log request
    console.log(`${new Date().toISOString()} - ${method} ${path} - IP: ${request.headers.get('CF-Connecting-IP') || 'unknown'}`);

    try {
      // Route handling
      if (path === '/health' && method === 'GET') {
        return await handleHealth();
      }
      
      if (path.startsWith('/debug/') && method === 'GET') {
        const orderNumber = path.split('/debug/')[1];
        return await handleDebug(orderNumber, env);
      }
      
      if (path === '/track' && method === 'POST') {
        return await handleTrack(request, env);
      }

      // 404 handler
      return createErrorResponse(
        'Endpoint not found',
        `The requested endpoint ${method} ${path} does not exist`,
        'ENDPOINT_NOT_FOUND',
        404
      );

    } catch (error) {
      console.error('Unhandled error:', error);
      return createErrorResponse(
        'Internal server error',
        'An unexpected error occurred',
        'UNHANDLED_ERROR',
        500
      );
    }
  }
};
