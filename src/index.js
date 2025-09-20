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
      deliveredAt: order.closed_at,
      buttonsDisabled: true,
      disabledReason: 'Order has been delivered'
    };
  }

  if (trackingNumber) {
    console.log('Order has tracking number, status: In Transit');
    return {
      status: 'In Transit',
      trackingNumber: trackingNumber,
      deliveredAt: null,
      buttonsDisabled: true,
      disabledReason: 'Order is in transit'
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
      deliveredAt: null,
      buttonsDisabled: false,
      disabledReason: null
    };
  } else {
    console.log('Order is in transit (more than 48 hours)');
    return {
      status: 'In Transit',
      trackingNumber: null,
      deliveredAt: null,
      buttonsDisabled: true,
      disabledReason: 'Order is in transit (48+ hours)'
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

// Code injection endpoint - injects button control directly into any page
async function handleCodeInjection(request, env) {
  try {
    const body = await request.json();
    const { orderNumber, email, targetUrl } = body;

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
    
    // Create HTML page that will inject the button control script
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Button Control Injection</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f8f9fa;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .status {
            background: #e8f4fd;
            padding: 20px;
            border-radius: 6px;
            margin: 20px 0;
            border-left: 4px solid #007cba;
        }
        .success { color: #28a745; }
        .warning { color: #ffc107; }
        .error { color: #dc3545; }
        .btn {
            background: #007cba;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin: 5px;
        }
        .btn:hover { background: #005a87; }
        .btn:disabled {
            background: #6c757d;
            cursor: not-allowed;
            opacity: 0.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🛒 Button Control Injection</h1>
        
        <div class="status">
            <h3>Order Status</h3>
            <p><strong>Order Number:</strong> ${order.name.replace('#', '')}</p>
            <p><strong>Status:</strong> <span class="${statusInfo.buttonsDisabled ? 'warning' : 'success'}">${statusInfo.status}</span></p>
            <p><strong>Buttons Disabled:</strong> <span class="${statusInfo.buttonsDisabled ? 'error' : 'success'}">${statusInfo.buttonsDisabled ? 'YES' : 'NO'}</span></p>
            <p><strong>Reason:</strong> ${statusInfo.disabledReason || 'N/A'}</p>
            ${statusInfo.trackingNumber ? `<p><strong>Tracking Number:</strong> ${statusInfo.trackingNumber}</p>` : ''}
        </div>

        <div class="status">
            <h3>Injection Status</h3>
            <p id="injectionStatus">Preparing to inject button control script...</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
            <button class="btn" onclick="injectScript()">Inject Button Control</button>
            <button class="btn" onclick="testButtons()">Test Buttons</button>
            <button class="btn" onclick="resetButtons()">Reset Buttons</button>
        </div>

        <div class="status">
            <h3>Demo Buttons (These will be controlled)</h3>
            <button class="btn product-form__cart-submit">Add to Cart</button>
            <button class="btn btn--full">Add to Cart (Full)</button>
            <button class="btn" name="add">Add to Cart (Named)</button>
            <button class="btn btn--primary">Primary Button</button>
            <button class="btn btn--secondary">Secondary Button</button>
        </div>

        <div class="status">
            <h3>Instructions</h3>
            <ol>
                <li>Click "Inject Button Control" to inject the script into this page</li>
                <li>Click "Test Buttons" to see the button control in action</li>
                <li>Click "Reset Buttons" to restore all buttons</li>
                <li>Use this same URL in an iframe on your Shopify store</li>
            </ol>
        </div>
    </div>

    <script>
        // Order data from API
        const orderData = {
            orderNumber: '${order.name.replace('#', '')}',
            status: '${statusInfo.status}',
            trackingNumber: '${statusInfo.trackingNumber || ''}',
            buttonsDisabled: ${statusInfo.buttonsDisabled},
            disabledReason: '${statusInfo.disabledReason || ''}'
        };

        // Button control script
        const buttonControlScript = \`
        (function() {
            'use strict';
            
            console.log('Button Control Injected: Order Status - \${orderData.status}');
            
            // Shopify-specific button selectors
            const ADD_TO_CART_SELECTORS = [
                '.product-form__cart-submit',
                '.btn--full',
                'button[name="add"]',
                'input[name="add"]',
                '.product-form__item--submit button',
                '.product-form__item button[type="submit"]',
                '.product-form__buttons button',
                '.product-single__add-to-cart',
                '.add-to-cart',
                '.btn-add-to-cart',
                '.add-to-cart-btn',
                '.btn--primary',
                '.btn--secondary',
                '.btn-theme',
                '#AddToCart',
                '.product-form__item--submit',
                '.product-form__cart',
                '.product-form__buttons',
                '.product-single__add-to-cart-wrapper button',
                '.product-form__item--submit .btn',
                '.btn[type="submit"]',
                'button[type="submit"]',
                '.product-form button',
                '.product-single__add-to-cart button'
            ];
            
            // Checkout button selectors
            const CHECKOUT_SELECTORS = [
                '.btn-cart-checkout',
                '.js-cart-btn-checkout',
                '.btn-checkout',
                '.checkout-btn',
                'button[name="checkout"]',
                'input[name="checkout"]',
                '.cart__checkout',
                '.cart-checkout'
            ];
            
            // Function to disable buttons
            function disableButtons() {
                let disabledCount = 0;
                
                ADD_TO_CART_SELECTORS.forEach(selector => {
                    const buttons = document.querySelectorAll(selector);
                    buttons.forEach(button => {
                        if (!button.disabled && !button.classList.contains('btn--sold-out')) {
                            button.disabled = true;
                            button.style.opacity = '0.6';
                            button.style.cursor = 'not-allowed';
                            button.title = '\${orderData.disabledReason || 'Add to Cart disabled due to order status'}';
                            button.classList.add('btn--disabled-by-tracking');
                            
                            // Change button text
                            const textElement = button.querySelector('span, .btn__text, .button-text');
                            if (textElement) {
                                textElement.dataset.originalText = textElement.textContent;
                                textElement.textContent = '\${orderData.status === 'Order Delivered' ? 'Order Delivered' : 'Order In Transit'}';
                            }
                            
                            disabledCount++;
                        }
                    });
                });
                
                CHECKOUT_SELECTORS.forEach(selector => {
                    const buttons = document.querySelectorAll(selector);
                    buttons.forEach(button => {
                        if (!button.disabled) {
                            button.disabled = true;
                            button.style.opacity = '0.6';
                            button.style.cursor = 'not-allowed';
                            button.title = '\${orderData.disabledReason || 'Checkout disabled due to order status'}';
                            button.classList.add('btn--disabled-by-tracking');
                        }
                    });
                });
                
                console.log('Disabled ' + disabledCount + ' buttons');
                return disabledCount;
            }
            
            // Function to enable buttons
            function enableButtons() {
                let enabledCount = 0;
                
                [...ADD_TO_CART_SELECTORS, ...CHECKOUT_SELECTORS].forEach(selector => {
                    const buttons = document.querySelectorAll(selector);
                    buttons.forEach(button => {
                        if (button.classList.contains('btn--disabled-by-tracking')) {
                            button.disabled = false;
                            button.style.opacity = '1';
                            button.style.cursor = 'pointer';
                            button.title = '';
                            button.classList.remove('btn--disabled-by-tracking');
                            
                            // Restore original text
                            const textElement = button.querySelector('span, .btn__text, .button-text');
                            if (textElement && textElement.dataset.originalText) {
                                textElement.textContent = textElement.dataset.originalText;
                            }
                            
                            enabledCount++;
                        }
                    });
                });
                
                console.log('Enabled ' + enabledCount + ' buttons');
                return enabledCount;
            }
            
            // Control buttons based on order status
            if (\${orderData.buttonsDisabled}) {
                disableButtons();
                showNotification('\${orderData.status}', '\${orderData.disabledReason || 'Add to Cart is currently disabled for this order'}');
            } else {
                enableButtons();
            }
            
            // Show notification
            function showNotification(title, message) {
                const existingNotification = document.querySelector('.shopify-tracking-notification');
                if (existingNotification) {
                    existingNotification.remove();
                }
                
                const notification = document.createElement('div');
                notification.className = 'shopify-tracking-notification';
                notification.style.cssText = \`
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #ffc107;
                    color: #000;
                    padding: 15px 20px;
                    border-radius: 4px;
                    z-index: 10000;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                    max-width: 350px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 14px;
                    line-height: 1.4;
                    border-left: 4px solid #ff9800;
                \`;
                
                notification.innerHTML = \`
                    <div style="font-weight: 600; margin-bottom: 5px;">\${title}</div>
                    <div style="font-size: 13px; opacity: 0.9;">\${message}</div>
                \`;
                
                document.body.appendChild(notification);
                
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.style.opacity = '0';
                        notification.style.transform = 'translateX(100%)';
                        notification.style.transition = 'all 0.3s ease';
                        setTimeout(() => {
                            if (notification.parentNode) {
                                notification.parentNode.removeChild(notification);
                            }
                        }, 300);
                    }
                }, 8000);
            }
            
            // Expose functions globally
            window.shopifyOrderTracking = {
                disableButtons: disableButtons,
                enableButtons: enableButtons,
                orderStatus: '\${orderData.status}',
                buttonsDisabled: \${orderData.buttonsDisabled},
                trackingNumber: '\${orderData.trackingNumber}',
                orderNumber: '\${orderData.orderNumber}'
            };
            
            // Listen for dynamic content changes
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        const newButtons = document.querySelectorAll(ADD_TO_CART_SELECTORS.join(', '));
                        newButtons.forEach(button => {
                            if (!button.classList.contains('btn--disabled-by-tracking') && 
                                !button.disabled && 
                                !button.classList.contains('btn--sold-out')) {
                                if (\${orderData.buttonsDisabled}) {
                                    button.disabled = true;
                                    button.style.opacity = '0.6';
                                    button.style.cursor = 'not-allowed';
                                    button.title = '\${orderData.disabledReason || 'Add to Cart disabled due to order status'}';
                                    button.classList.add('btn--disabled-by-tracking');
                                }
                            }
                        });
                    }
                });
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            console.log('Button Control Script Injected Successfully');
        })();
        \`;

        // Functions for the demo page
        function injectScript() {
            try {
                eval(buttonControlScript);
                document.getElementById('injectionStatus').innerHTML = '<span class="success">✅ Button control script injected successfully!</span>';
                console.log('Button control script injected');
            } catch (error) {
                document.getElementById('injectionStatus').innerHTML = '<span class="error">❌ Error injecting script: ' + error.message + '</span>';
                console.error('Error injecting script:', error);
            }
        }

        function testButtons() {
            if (window.shopifyOrderTracking) {
                if (orderData.buttonsDisabled) {
                    window.shopifyOrderTracking.disableButtons();
                    document.getElementById('injectionStatus').innerHTML = '<span class="warning">⚠️ Buttons disabled based on order status</span>';
                } else {
                    window.shopifyOrderTracking.enableButtons();
                    document.getElementById('injectionStatus').innerHTML = '<span class="success">✅ Buttons enabled based on order status</span>';
                }
            } else {
                document.getElementById('injectionStatus').innerHTML = '<span class="error">❌ Button control script not loaded. Click "Inject Button Control" first.</span>';
            }
        }

        function resetButtons() {
            if (window.shopifyOrderTracking) {
                window.shopifyOrderTracking.enableButtons();
                document.getElementById('injectionStatus').innerHTML = '<span class="success">✅ All buttons reset to enabled state</span>';
            } else {
                // Manual reset
                const buttonSelectors = [
                    '.product-form__cart-submit',
                    '.btn--full',
                    'button[name="add"]',
                    '.btn--primary',
                    '.btn--secondary'
                ];
                
                buttonSelectors.forEach(selector => {
                    const buttons = document.querySelectorAll(selector);
                    buttons.forEach(button => {
                        button.disabled = false;
                        button.style.opacity = '1';
                        button.style.cursor = 'pointer';
                        button.title = '';
                        button.classList.remove('btn--disabled-by-tracking');
                    });
                });
                
                document.getElementById('injectionStatus').innerHTML = '<span class="success">✅ All buttons manually reset</span>';
            }
        }

        // Auto-inject on page load
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(() => {
                injectScript();
            }, 1000);
        });
    </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ...handleCORS(request)
      }
    });

  } catch (error) {
    console.error('Error in code injection endpoint:', error.message);
    return createErrorResponse(
      'Internal server error',
      'An unexpected error occurred while processing your request',
      'INTERNAL_ERROR',
      500
    );
  }
}

// Shopify-specific button control endpoint - returns JavaScript for Shopify integration
async function handleShopifyButtonControl(request, env) {
  try {
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
    
    // Create JavaScript code for Shopify integration
    const jsCode = `
// Shopify Add to Cart Button Control Script
// Generated by Shopify Order Tracking API
(function() {
    'use strict';
    
    console.log('Shopify Button Control: Order Status - ${statusInfo.status}');
    
    // Shopify-specific button selectors
    const ADD_TO_CART_SELECTORS = [
        // Primary Add to Cart buttons
        '.product-form__cart-submit',
        '.btn--full',
        'button[name="add"]',
        'input[name="add"]',
        '.product-form__item--submit button',
        '.product-form__item button[type="submit"]',
        '.product-form__buttons button',
        '.product-single__add-to-cart',
        '.add-to-cart',
        '.btn-add-to-cart',
        '.add-to-cart-btn',
        '.btn--primary',
        '.btn--secondary',
        '.btn-theme',
        // Shopify theme specific selectors
        '#AddToCart',
        '.product-form__item--submit',
        '.product-form__cart',
        '.product-form__buttons',
        '.product-single__add-to-cart-wrapper button',
        '.product-form__item--submit .btn',
        // Common Shopify button classes
        '.btn[type="submit"]',
        'button[type="submit"]',
        '.product-form button',
        '.product-single__add-to-cart button'
    ];
    
    // Checkout button selectors (secondary)
    const CHECKOUT_SELECTORS = [
        '.btn-cart-checkout',
        '.js-cart-btn-checkout',
        '.btn-checkout',
        '.checkout-btn',
        'button[name="checkout"]',
        'input[name="checkout"]',
        '.cart__checkout',
        '.cart-checkout'
    ];
    
    // Function to disable buttons
    function disableButtons() {
        let disabledCount = 0;
        
        // Disable Add to Cart buttons first (primary focus)
        ADD_TO_CART_SELECTORS.forEach(selector => {
            const buttons = document.querySelectorAll(selector);
            buttons.forEach(button => {
                if (!button.disabled && !button.classList.contains('btn--sold-out')) {
                    button.disabled = true;
                    button.style.opacity = '0.6';
                    button.style.cursor = 'not-allowed';
                    button.title = '${statusInfo.disabledReason || 'Add to Cart disabled due to order status'}';
                    
                    // Add visual indicator
                    button.classList.add('btn--disabled-by-tracking');
                    
                    // Change button text if possible
                    const textElement = button.querySelector('span, .btn__text, .button-text');
                    if (textElement) {
                        textElement.textContent = '${statusInfo.status === 'Order Delivered' ? 'Order Delivered' : 'Order In Transit'}';
                    }
                    
                    disabledCount++;
                }
            });
        });
        
        // Also disable checkout buttons
        CHECKOUT_SELECTORS.forEach(selector => {
            const buttons = document.querySelectorAll(selector);
            buttons.forEach(button => {
                if (!button.disabled) {
                    button.disabled = true;
                    button.style.opacity = '0.6';
                    button.style.cursor = 'not-allowed';
                    button.title = '${statusInfo.disabledReason || 'Checkout disabled due to order status'}';
                    button.classList.add('btn--disabled-by-tracking');
                }
            });
        });
        
        console.log('Shopify Button Control: Disabled ' + disabledCount + ' Add to Cart buttons');
        return disabledCount;
    }
    
    // Function to enable buttons
    function enableButtons() {
        let enabledCount = 0;
        
        [...ADD_TO_CART_SELECTORS, ...CHECKOUT_SELECTORS].forEach(selector => {
            const buttons = document.querySelectorAll(selector);
            buttons.forEach(button => {
                if (button.classList.contains('btn--disabled-by-tracking')) {
                    button.disabled = false;
                    button.style.opacity = '1';
                    button.style.cursor = 'pointer';
                    button.title = '';
                    button.classList.remove('btn--disabled-by-tracking');
                    
                    // Restore original button text
                    const textElement = button.querySelector('span, .btn__text, .button-text');
                    if (textElement && textElement.dataset.originalText) {
                        textElement.textContent = textElement.dataset.originalText;
                    }
                    
                    enabledCount++;
                }
            });
        });
        
        console.log('Shopify Button Control: Enabled ' + enabledCount + ' buttons');
        return enabledCount;
    }
    
    // Store original button text before disabling
    function storeOriginalText() {
        ADD_TO_CART_SELECTORS.forEach(selector => {
            const buttons = document.querySelectorAll(selector);
            buttons.forEach(button => {
                const textElement = button.querySelector('span, .btn__text, .button-text');
                if (textElement && !textElement.dataset.originalText) {
                    textElement.dataset.originalText = textElement.textContent;
                }
            });
        });
    }
    
    // Control buttons based on order status
    if (${statusInfo.buttonsDisabled}) {
        storeOriginalText();
        disableButtons();
        
        // Show Shopify-style notification
        showShopifyNotification('${statusInfo.status}', '${statusInfo.disabledReason || 'Add to Cart is currently disabled for this order'}');
    } else {
        enableButtons();
    }
    
    // Show notification in Shopify style
    function showShopifyNotification(title, message) {
        // Remove existing notifications
        const existingNotification = document.querySelector('.shopify-tracking-notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        const notification = document.createElement('div');
        notification.className = 'shopify-tracking-notification';
        notification.style.cssText = \`
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ffc107;
            color: #000;
            padding: 15px 20px;
            border-radius: 4px;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            max-width: 350px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.4;
            border-left: 4px solid #ff9800;
        \`;
        
        notification.innerHTML = \`
            <div style="font-weight: 600; margin-bottom: 5px;">\${title}</div>
            <div style="font-size: 13px; opacity: 0.9;">\${message}</div>
        \`;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                notification.style.transform = 'translateX(100%)';
                notification.style.transition = 'all 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 8000);
    }
    
    // Expose functions globally for manual control
    window.shopifyOrderTracking = {
        disableButtons: disableButtons,
        enableButtons: enableButtons,
        orderStatus: '${statusInfo.status}',
        buttonsDisabled: ${statusInfo.buttonsDisabled},
        trackingNumber: '${statusInfo.trackingNumber || ''}',
        orderNumber: '${order.name.replace('#', '')}'
    };
    
    // Listen for dynamic content changes (for AJAX-loaded content)
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Check if new buttons were added
                const newButtons = document.querySelectorAll(ADD_TO_CART_SELECTORS.join(', '));
                newButtons.forEach(button => {
                    if (!button.classList.contains('btn--disabled-by-tracking') && 
                        !button.disabled && 
                        !button.classList.contains('btn--sold-out')) {
                        if (${statusInfo.buttonsDisabled}) {
                            button.disabled = true;
                            button.style.opacity = '0.6';
                            button.style.cursor = 'not-allowed';
                            button.title = '${statusInfo.disabledReason || 'Add to Cart disabled due to order status'}';
                            button.classList.add('btn--disabled-by-tracking');
                        }
                    }
                });
            }
        });
    });
    
    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    console.log('Shopify Button Control: Script loaded successfully');
})();
`;

    return new Response(jsCode, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        ...handleCORS(request)
      }
    });

  } catch (error) {
    console.error('Error in Shopify button control endpoint:', error.message);
    return createErrorResponse(
      'Internal server error',
      'An unexpected error occurred while processing your request',
      'INTERNAL_ERROR',
      500
    );
  }
}

// Button control endpoint - returns HTML with embedded JavaScript
async function handleButtonControl(request, env) {
  try {
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
    
    // Create HTML response with embedded JavaScript
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Order Status - Button Control</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .status-info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .button-control { background: #e8f4fd; padding: 15px; border-radius: 5px; margin: 10px 0; }
        .success { color: #28a745; }
        .warning { color: #ffc107; }
        .error { color: #dc3545; }
    </style>
</head>
<body>
    <div class="status-info">
        <h3>Order Status</h3>
        <p><strong>Order Number:</strong> ${order.name.replace('#', '')}</p>
        <p><strong>Status:</strong> <span class="${statusInfo.buttonsDisabled ? 'warning' : 'success'}">${statusInfo.status}</span></p>
        ${statusInfo.trackingNumber ? `<p><strong>Tracking Number:</strong> ${statusInfo.trackingNumber}</p>` : ''}
        <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
        ${statusInfo.deliveredAt ? `<p><strong>Delivered At:</strong> ${new Date(statusInfo.deliveredAt).toLocaleString()}</p>` : ''}
    </div>
    
    <div class="button-control">
        <h3>Button Control Status</h3>
        <p><strong>Buttons Disabled:</strong> <span class="${statusInfo.buttonsDisabled ? 'error' : 'success'}">${statusInfo.buttonsDisabled ? 'YES' : 'NO'}</span></p>
        ${statusInfo.disabledReason ? `<p><strong>Reason:</strong> ${statusInfo.disabledReason}</p>` : ''}
    </div>

    <script>
        // This script will run on the page and control buttons
        (function() {
            console.log('Order tracking button control script loaded');
            
            // Function to disable buttons
            function disableButtons() {
                const buttonSelectors = [
                    // Shopify Add to Cart buttons
                    '.product-form__cart-submit',
                    '.btn--full',
                    '.add-to-cart-btn',
                    'button[name="add"]',
                    'input[name="add"]',
                    '.product-form__item--submit button',
                    '.btn-theme',
                    '.btn--primary',
                    '.btn--secondary',
                    // Common Shopify selectors
                    '.product-form__buttons button',
                    '.product-form__item button[type="submit"]',
                    '.product-single__add-to-cart',
                    '.add-to-cart',
                    '.btn-add-to-cart',
                    // Checkout buttons (secondary)
                    '.btn-cart-checkout',
                    '.js-cart-btn-checkout', 
                    '.btn-checkout',
                    '.checkout-btn',
                    'button[name="checkout"]',
                    'input[name="checkout"]'
                ];
                
                let disabledCount = 0;
                
                buttonSelectors.forEach(selector => {
                    const buttons = document.querySelectorAll(selector);
                    buttons.forEach(button => {
                        if (!button.disabled) {
                            button.disabled = true;
                            button.style.opacity = '0.6';
                            button.style.cursor = 'not-allowed';
                            button.title = '${statusInfo.disabledReason || 'Button disabled due to order status'}';
                            disabledCount++;
                        }
                    });
                });
                
                console.log('Disabled ' + disabledCount + ' buttons');
                return disabledCount;
            }
            
            // Function to enable buttons
            function enableButtons() {
                const buttonSelectors = [
                    // Shopify Add to Cart buttons
                    '.product-form__cart-submit',
                    '.btn--full',
                    '.add-to-cart-btn',
                    'button[name="add"]',
                    'input[name="add"]',
                    '.product-form__item--submit button',
                    '.btn-theme',
                    '.btn--primary',
                    '.btn--secondary',
                    // Common Shopify selectors
                    '.product-form__buttons button',
                    '.product-form__item button[type="submit"]',
                    '.product-single__add-to-cart',
                    '.add-to-cart',
                    '.btn-add-to-cart',
                    // Checkout buttons (secondary)
                    '.btn-cart-checkout',
                    '.js-cart-btn-checkout', 
                    '.btn-checkout',
                    '.checkout-btn',
                    'button[name="checkout"]',
                    'input[name="checkout"]'
                ];
                
                let enabledCount = 0;
                
                buttonSelectors.forEach(selector => {
                    const buttons = document.querySelectorAll(selector);
                    buttons.forEach(button => {
                        if (button.disabled && button.title.includes('Button disabled due to order status')) {
                            button.disabled = false;
                            button.style.opacity = '1';
                            button.style.cursor = 'pointer';
                            button.title = '';
                            enabledCount++;
                        }
                    });
                });
                
                console.log('Enabled ' + enabledCount + ' buttons');
                return enabledCount;
            }
            
            // Control buttons based on order status
            if (${statusInfo.buttonsDisabled}) {
                disableButtons();
            } else {
                enableButtons();
            }
            
            // Expose functions globally for manual control
            window.orderTrackingControl = {
                disableButtons: disableButtons,
                enableButtons: enableButtons,
                orderStatus: '${statusInfo.status}',
                buttonsDisabled: ${statusInfo.buttonsDisabled}
            };
            
            // Show notification
            if (${statusInfo.buttonsDisabled}) {
                const notification = document.createElement('div');
                notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #ffc107; color: #000; padding: 15px; border-radius: 5px; z-index: 10000; box-shadow: 0 2px 10px rgba(0,0,0,0.2);';
                notification.innerHTML = '<strong>Order Status:</strong> ${statusInfo.status}<br><small>${statusInfo.disabledReason || 'Add to Cart buttons have been disabled'}</small>';
                document.body.appendChild(notification);
                
                // Auto-remove notification after 5 seconds
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 5000);
            }
        })();
    </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        ...handleCORS(request)
      }
    });

  } catch (error) {
    console.error('Error in button control endpoint:', error.message);
    return createErrorResponse(
      'Internal server error',
      'An unexpected error occurred while processing your request',
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
        deliveredAt: statusInfo.deliveredAt,
        buttonsDisabled: statusInfo.buttonsDisabled,
        disabledReason: statusInfo.disabledReason
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
      
      if (path === '/button-control' && method === 'POST') {
        return await handleButtonControl(request, env);
      }
      
      if (path === '/shopify-button-control' && method === 'POST') {
        return await handleShopifyButtonControl(request, env);
      }
      
      if (path === '/inject' && method === 'POST') {
        return await handleCodeInjection(request, env);
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
