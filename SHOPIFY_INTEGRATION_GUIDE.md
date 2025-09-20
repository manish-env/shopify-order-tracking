# 🛒 Shopify Integration Guide

This guide shows you how to integrate the Order Tracking API with your Shopify store to automatically disable Add to Cart buttons based on order status.

## 🚀 Quick Start

### Step 1: Deploy Your API
```bash
npm run deploy
```

### Step 2: Get Your API URL
After deployment, you'll get a URL like: `https://your-api-name.your-subdomain.workers.dev`

### Step 3: Add to Your Shopify Theme

#### Option A: Add to theme.liquid (Recommended)
1. Go to **Online Store > Themes**
2. Click **Actions > Edit code**
3. Open `layout/theme.liquid`
4. Add this code before the closing `</body>` tag:

```liquid
<script>
// Shopify Add to Cart Button Control
(function() {
    const API_URL = 'https://your-api-name.your-subdomain.workers.dev';
    
    // Function to check order status and control buttons
    async function checkOrderAndControlButtons(orderNumber, email) {
        try {
            const response = await fetch(`${API_URL}/shopify-button-control`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    orderNumber: orderNumber,
                    email: email
                })
            });
            
            if (response.ok) {
                const script = await response.text();
                eval(script);
            }
        } catch (error) {
            console.error('Error loading button control:', error);
        }
    }
    
    // Make function globally available
    window.checkOrderStatus = checkOrderAndControlButtons;
    
    // Auto-check if order info is in URL
    const urlParams = new URLSearchParams(window.location.search);
    const orderNumber = urlParams.get('order');
    const email = urlParams.get('email');
    
    if (orderNumber) {
        checkOrderAndControlButtons(orderNumber, email);
    }
})();
</script>
```

#### Option B: Add to Specific Templates
Add the same code to specific templates like:
- `templates/product.liquid` (for product pages)
- `templates/cart.liquid` (for cart page)
- `templates/collection.liquid` (for collection pages)

### Step 4: Test the Integration

1. **Test with URL parameters:**
   ```
   https://your-store.myshopify.com/products/your-product?order=12345&email=customer@example.com
   ```

2. **Test with JavaScript:**
   ```javascript
   // In browser console
   window.checkOrderStatus('12345', 'customer@example.com');
   ```

## 🎯 How It Works

### Button Control Logic
- **Order Processing** (0-48 hours): Add to Cart buttons are **ENABLED**
- **In Transit** (48+ hours or has tracking): Add to Cart buttons are **DISABLED**
- **Order Delivered**: Add to Cart buttons are **DISABLED**

### Button Selectors Targeted
The system automatically finds and controls these Shopify button types:
- `.product-form__cart-submit`
- `.btn--full`
- `button[name="add"]`
- `.product-form__item--submit button`
- `.btn--primary`, `.btn--secondary`, `.btn-theme`
- And many more Shopify-specific selectors

## 🔧 Advanced Configuration

### Custom Button Selectors
If your theme uses custom button classes, you can modify the selectors in the API response or add them to your theme:

```javascript
// Add custom selectors
const customSelectors = [
    '.your-custom-add-to-cart',
    '.custom-button-class'
];

// Apply to custom buttons
customSelectors.forEach(selector => {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(button => {
        // Apply same logic as other buttons
    });
});
```

### Manual Control
After the script loads, you can manually control buttons:

```javascript
// Disable all buttons
window.shopifyOrderTracking.disableButtons();

// Enable all buttons
window.shopifyOrderTracking.enableButtons();

// Check current status
console.log(window.shopifyOrderTracking.orderStatus);
console.log(window.shopifyOrderTracking.buttonsDisabled);
```

## 📱 Integration Examples

### Example 1: Product Page Integration
Add to `templates/product.liquid`:

```liquid
{% comment %} Add to Cart Button Control {% endcomment %}
<script>
document.addEventListener('DOMContentLoaded', function() {
    // Check if this is a specific product that should have button control
    {% if product.tags contains 'tracking-enabled' %}
        const orderNumber = '{{ order.number | default: "" }}';
        const email = '{{ customer.email | default: "" }}';
        
        if (orderNumber || email) {
            window.checkOrderStatus(orderNumber, email);
        }
    {% endif %}
});
</script>
```

### Example 2: Cart Page Integration
Add to `templates/cart.liquid`:

```liquid
<script>
document.addEventListener('DOMContentLoaded', function() {
    // Check order status when cart page loads
    const orderNumber = '{{ cart.attributes.order_number | default: "" }}';
    const email = '{{ customer.email | default: "" }}';
    
    if (orderNumber || email) {
        window.checkOrderStatus(orderNumber, email);
    }
});
</script>
```

### Example 3: Collection Page Integration
Add to `templates/collection.liquid`:

```liquid
<script>
document.addEventListener('DOMContentLoaded', function() {
    // Check order status for collection pages
    const urlParams = new URLSearchParams(window.location.search);
    const orderNumber = urlParams.get('order');
    const email = urlParams.get('email');
    
    if (orderNumber || email) {
        window.checkOrderStatus(orderNumber, email);
    }
});
</script>
```

## 🎨 Styling Customization

### Custom Button Styles
Add CSS to your theme to style disabled buttons:

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
The system shows notifications by default. You can customize them:

```javascript
// Override the notification function
window.shopifyOrderTracking.showNotification = function(title, message) {
    // Your custom notification code here
    console.log(title + ': ' + message);
};
```

## 🔍 Troubleshooting

### Common Issues

1. **Buttons not being disabled:**
   - Check if your theme uses different CSS selectors
   - Verify the API is returning the correct response
   - Check browser console for errors

2. **Script not loading:**
   - Verify your API URL is correct
   - Check if your store has CORS restrictions
   - Ensure the API is deployed and accessible

3. **Buttons re-enabling unexpectedly:**
   - Check if your theme has JavaScript that re-enables buttons
   - Verify the order status logic is correct
   - Check for conflicting scripts

### Debug Mode
Enable debug mode to see detailed logs:

```javascript
// Add this before calling checkOrderStatus
window.shopifyOrderTrackingDebug = true;
window.checkOrderStatus('12345', 'customer@example.com');
```

## 📊 Monitoring

### Check Button Status
```javascript
// Get current button control status
const status = window.shopifyOrderTracking;
console.log('Order Status:', status.orderStatus);
console.log('Buttons Disabled:', status.buttonsDisabled);
console.log('Tracking Number:', status.trackingNumber);
```

### Manual Testing
```javascript
// Test with specific order
window.checkOrderStatus('12345', 'customer@example.com');

// Reset all buttons
window.shopifyOrderTracking.enableButtons();

// Disable all buttons
window.shopifyOrderTracking.disableButtons();
```

## 🚀 Production Deployment

### Before Going Live
1. ✅ Test with real order numbers and emails
2. ✅ Verify button selectors work with your theme
3. ✅ Test on mobile devices
4. ✅ Check performance impact
5. ✅ Set up monitoring

### Performance Considerations
- The script is lightweight and loads quickly
- Button control happens asynchronously
- No impact on page load speed
- Works with Shopify's AJAX cart functionality

## 📞 Support

If you need help with integration:
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
