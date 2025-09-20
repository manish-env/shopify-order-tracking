# 🛒 Iframe Integration Guide - Zero Theme Modifications

This guide shows you how to inject button control code into your Shopify store **without modifying any theme files** using the iframe method.

## 🚀 Quick Start

### Step 1: Deploy Your API
```bash
npm run deploy
```

### Step 2: Get Your API URL
After deployment, you'll get a URL like: `https://your-api-name.your-subdomain.workers.dev`

### Step 3: Add Iframe to Shopify

#### Option A: Add to Any Page (Recommended)
1. Go to **Online Store > Pages**
2. Create a new page or edit existing page
3. Add this HTML in the page content:

```html
<iframe 
    id="button-control-iframe"
    src="https://your-api-name.your-subdomain.workers.dev/inject?order=12345&email=customer@example.com"
    style="width: 1px; height: 1px; border: none; position: absolute; left: -9999px;"
    onload="console.log('Button control loaded')">
</iframe>
```

#### Option B: Add to Product Pages
1. Go to **Online Store > Themes**
2. Click **Actions > Edit code**
3. Open `templates/product.liquid`
4. Add the iframe code before the closing `</body>` tag

#### Option C: Add via Shopify App
If you're building a Shopify app, inject the iframe programmatically:

```javascript
// In your Shopify app's frontend code
function injectButtonControlIframe(orderNumber, email) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://your-api-name.your-subdomain.workers.dev/inject?order=${orderNumber}&email=${email}`;
    iframe.style.cssText = 'width: 1px; height: 1px; border: none; position: absolute; left: -9999px;';
    iframe.onload = function() {
        console.log('Button control iframe loaded');
    };
    document.body.appendChild(iframe);
}

// Call when app loads
document.addEventListener('DOMContentLoaded', function() {
    const orderNumber = window.appData?.orderNumber;
    const email = window.appData?.email;
    
    if (orderNumber || email) {
        injectButtonControlIframe(orderNumber, email);
    }
});
```

## 🎯 How It Works

### The Iframe Method
1. **Hidden Iframe**: A 1x1 pixel iframe loads the button control page
2. **Script Injection**: The iframe contains JavaScript that controls buttons on the parent page
3. **Cross-Domain**: Works across different domains (API domain vs Shopify domain)
4. **Zero Modifications**: No changes needed to your Shopify theme files

### Button Control Logic
- **Order Processing** (0-48 hours): Add to Cart buttons are **ENABLED**
- **In Transit** (48+ hours or has tracking): Add to Cart buttons are **DISABLED**
- **Order Delivered**: Add to Cart buttons are **DISABLED**

## 🔧 Advanced Configuration

### Dynamic Order Detection
```html
<script>
// Auto-detect order from URL parameters
const urlParams = new URLSearchParams(window.location.search);
const orderNumber = urlParams.get('order');
const email = urlParams.get('email');

if (orderNumber || email) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://your-api-name.your-subdomain.workers.dev/inject?order=${orderNumber}&email=${email}`;
    iframe.style.cssText = 'width: 1px; height: 1px; border: none; position: absolute; left: -9999px;';
    document.body.appendChild(iframe);
}
</script>
```

### Multiple Order Support
```html
<script>
// Support multiple orders on the same page
function loadButtonControlForOrder(orderNumber, email) {
    const iframe = document.createElement('iframe');
    iframe.id = `button-control-${orderNumber}`;
    iframe.src = `https://your-api-name.your-subdomain.workers.dev/inject?order=${orderNumber}&email=${email}`;
    iframe.style.cssText = 'width: 1px; height: 1px; border: none; position: absolute; left: -9999px;';
    document.body.appendChild(iframe);
}

// Load for multiple orders
loadButtonControlForOrder('12345', 'customer1@example.com');
loadButtonControlForOrder('12346', 'customer2@example.com');
</script>
```

### Error Handling
```html
<script>
function loadButtonControlWithErrorHandling(orderNumber, email) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://your-api-name.your-subdomain.workers.dev/inject?order=${orderNumber}&email=${email}`;
    iframe.style.cssText = 'width: 1px; height: 1px; border: none; position: absolute; left: -9999px;';
    
    iframe.onload = function() {
        console.log('Button control loaded successfully');
    };
    
    iframe.onerror = function() {
        console.error('Failed to load button control');
        // Fallback: manually disable buttons or show message
    };
    
    document.body.appendChild(iframe);
}
</script>
```

## 📱 Integration Examples

### Example 1: Product Page Integration
Add to `templates/product.liquid`:

```liquid
{% comment %} Add to Cart Button Control via Iframe {% endcomment %}
<iframe 
    id="button-control-iframe"
    src="https://your-api-name.your-subdomain.workers.dev/inject?order={{ order.number | default: '' }}&email={{ customer.email | default: '' }}"
    style="width: 1px; height: 1px; border: none; position: absolute; left: -9999px;"
    onload="console.log('Button control loaded for product page')">
</iframe>
```

### Example 2: Cart Page Integration
Add to `templates/cart.liquid`:

```liquid
<iframe 
    id="button-control-iframe"
    src="https://your-api-name.your-subdomain.workers.dev/inject?order={{ cart.attributes.order_number | default: '' }}&email={{ customer.email | default: '' }}"
    style="width: 1px; height: 1px; border: none; position: absolute; left: -9999px;"
    onload="console.log('Button control loaded for cart page')">
</iframe>
```

### Example 3: Collection Page Integration
Add to `templates/collection.liquid`:

```liquid
<script>
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const orderNumber = urlParams.get('order');
    const email = urlParams.get('email');
    
    if (orderNumber || email) {
        const iframe = document.createElement('iframe');
        iframe.src = `https://your-api-name.your-subdomain.workers.dev/inject?order=${orderNumber}&email=${email}`;
        iframe.style.cssText = 'width: 1px; height: 1px; border: none; position: absolute; left: -9999px;';
        document.body.appendChild(iframe);
    }
});
</script>
```

## 🎨 Styling Customization

### Custom Button Styles
The iframe method automatically applies styles to disabled buttons. You can customize these by adding CSS to your theme:

```css
/* Add to your theme's CSS file */
.btn--disabled-by-tracking {
    opacity: 0.6 !important;
    cursor: not-allowed !important;
    background-color: #6c757d !important;
    color: #fff !important;
}

.btn--disabled-by-tracking:hover {
    background-color: #6c757d !important;
    transform: none !important;
}
```

### Custom Notifications
The iframe shows notifications by default. You can customize them by modifying the iframe source or adding custom CSS:

```css
.shopify-tracking-notification {
    /* Your custom notification styles */
    background: #your-color !important;
    border-radius: 8px !important;
    /* ... other styles ... */
}
```

## 🔍 Troubleshooting

### Common Issues

1. **Buttons not being disabled:**
   - Check if your theme uses different CSS selectors
   - Verify the iframe is loading correctly
   - Check browser console for errors
   - Ensure the API is accessible

2. **Iframe not loading:**
   - Verify your API URL is correct
   - Check if your store has iframe restrictions
   - Ensure the API is deployed and accessible
   - Check for CORS issues

3. **Script not injecting:**
   - Check if the iframe is loading the correct page
   - Verify the order number and email are correct
   - Check browser console for JavaScript errors
   - Ensure the iframe has access to the parent page

### Debug Mode
Enable debug mode to see detailed logs:

```html
<script>
// Add this before loading the iframe
window.shopifyOrderTrackingDebug = true;

const iframe = document.createElement('iframe');
iframe.src = 'https://your-api-name.your-subdomain.workers.dev/inject?order=12345&email=customer@example.com';
iframe.style.cssText = 'width: 1px; height: 1px; border: none; position: absolute; left: -9999px;';
iframe.onload = function() {
    console.log('Button control iframe loaded');
};
document.body.appendChild(iframe);
</script>
```

## 📊 Monitoring

### Check Button Status
```javascript
// Get current button control status
if (window.shopifyOrderTracking) {
    console.log('Order Status:', window.shopifyOrderTracking.orderStatus);
    console.log('Buttons Disabled:', window.shopifyOrderTracking.buttonsDisabled);
    console.log('Tracking Number:', window.shopifyOrderTracking.trackingNumber);
} else {
    console.log('Button control not loaded');
}
```

### Manual Testing
```javascript
// Test with specific order
const iframe = document.createElement('iframe');
iframe.src = 'https://your-api-name.your-subdomain.workers.dev/inject?order=12345&email=customer@example.com';
iframe.style.cssText = 'width: 1px; height: 1px; border: none; position: absolute; left: -9999px;';
document.body.appendChild(iframe);

// Manual control after iframe loads
setTimeout(() => {
    if (window.shopifyOrderTracking) {
        window.shopifyOrderTracking.disableButtons();
    }
}, 2000);
```

## 🚀 Production Deployment

### Before Going Live
1. ✅ Test with real order numbers and emails
2. ✅ Verify iframe loads correctly on all pages
3. ✅ Test on mobile devices
4. ✅ Check performance impact
5. ✅ Set up monitoring

### Performance Considerations
- The iframe is only 1x1 pixel and hidden
- Minimal impact on page load speed
- Works with Shopify's AJAX cart functionality
- No impact on SEO or page performance

## 📞 Support

If you need help with iframe integration:
1. Check the browser console for errors
2. Test with the provided example files
3. Verify your API is working correctly
4. Check the README for detailed API documentation

## 🎉 Success!

Once integrated, your Shopify store will automatically:
- ✅ Disable Add to Cart buttons for orders in transit
- ✅ Disable Add to Cart buttons for delivered orders
- ✅ Show helpful notifications to customers
- ✅ Work seamlessly with any Shopify theme
- ✅ Handle dynamic content and AJAX updates
- ✅ **Require zero theme modifications**

The iframe method is perfect for:
- Shopify apps
- Page builders
- Custom content areas
- Any situation where you can't modify theme files
- Cross-domain integrations
