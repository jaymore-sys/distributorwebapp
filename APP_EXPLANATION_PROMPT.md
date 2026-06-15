# Distributor Web App: Complete AI Context Prompt

Copy the text below into another AI when asking it to explain, debug, extend, redesign, or review this application.

---

## Prompt For Another AI

You are working with a mobile-first, multi-brand distributor sales dashboard named `distributer-dashboard`. Treat the following description as the current source-of-truth architecture and business context. Do not assume that it has a traditional backend server: the React frontend talks directly to Firebase Authentication, Cloud Firestore, and Firebase Storage.

### 1. Product purpose

The application is a sales and inventory portal for three related consumer-product brands:

- **Drink Valencia**: hydration/energy drinks, orange visual theme.
- **Bounce**: drinks, light-blue visual theme.
- **Crunzzo**: snacks, red visual theme.

Each brand has two user experiences:

- **Distributor portal**: records shop/customer sales, selects products, calculates totals, submits orders, views personal sales history, downloads invoices, shares order confirmations through WhatsApp, and edits the distributor profile.
- **Admin portal**: views all brand sales and inventory, reviews dashboard analytics, creates and manages products, controls stock/status, and edits the admin profile.

Although all three brands live in one React codebase, each brand uses a separate Firebase project and therefore has isolated authentication users, Firestore data, and Storage files.

### 2. Technology stack

- React 19.2
- React DOM 19.2
- React Router DOM 7.13
- Vite 8
- Firebase Web SDK 12.10
- Plain CSS plus extensive inline React styles
- No Redux, Zustand, React Context, backend API server, TypeScript, component library, test framework, or lint configuration
- `gh-pages` is installed and `npm run deploy` publishes `dist`

Package scripts:

```text
npm run dev       -> starts Vite
npm run build     -> creates the production bundle
npm run preview   -> previews the production bundle
npm run deploy    -> builds and publishes dist with gh-pages
```

### 3. Runtime architecture

The browser entry point is `src/main.jsx`. It mounts `App` inside `BrowserRouter` and `React.StrictMode`.

`src/App.jsx` defines these routes:

```text
/                                  Landing page
/choose-section                    Brand selection
/login?section=valencia|bounce|crunzzo
/valencia/distributor/:tab?
/valencia/admin/:tab?
/bounce/distributor/:tab?
/bounce/admin/:tab?
/crunzzo/distributor/:tab?
/crunzzo/admin/:tab?
*                                  Redirects to /
```

There is no shared route-guard component in active use. `components/common/ProtectedRoute.jsx` and `components/common/Loader.jsx` are empty. Every dashboard listens to Firebase auth itself and redirects unauthenticated users to `/choose-section`.

### 4. Public user journey

1. `/` shows Valencia branding, a hero image, and a **Get Started** button.
2. `/choose-section` shows cards for Valencia, Bounce, and Crunzzo.
3. A brand card opens `/login?section=<brand>`.
4. The same login component changes logo, colors, and Firebase services based on the `section` query parameter.
5. After email/password or Google authentication, the app reads `users/{uid}` from that brand's Firestore project.
6. A profile with role `admin` goes to the brand admin dashboard. Every other role value goes to the distributor dashboard, although a missing role is rejected.

### 5. Firebase organization

`src/firebase/index.js` initializes three named Firebase apps:

```text
crunzzo  -> Firebase project crunzzo
bounce   -> Firebase project bounce-a86f0
valencia -> Firebase project drink-valencia
```

For every brand, the application exposes:

- `auth`: Firebase Authentication
- `db`: Cloud Firestore
- `storage`: Firebase Storage

`getFirebaseServices(brand)` returns the correct isolated services. The selected brand is also written to local storage under `selected_backend`, but current dashboards directly request their brand services and do not read that value.

Firebase web configuration is hardcoded in `src/firebase/index.js`. No `.env` files, Firebase rules, Firebase CLI configuration, or emulator configuration are included in the repository.

### 6. Authentication and account behavior

The shared login page supports:

- Email/password login
- Email/password distributor signup
- Password-reset email
- Google popup login for an already-existing Firestore profile

Signup fields:

- Full name
- Business name
- 10-digit phone number
- Email
- Password and confirmation, minimum 6 characters

New signups are automatically created as active distributors. The app generates an ID such as `DIST-ABC123` from the first six characters of the Firebase UID.

Approximate new user document:

```js
users/{uid} = {
  name,
  businessName,
  phone,
  role: "distributor",
  distributorId,
  status: "active",
  section: "valencia" | "bounce" | "crunzzo",
  createdAt: serverTimestamp()
}
```

Google login does not create a profile automatically. If `users/{uid}` does not exist in the selected brand database, the app signs the Google user out and asks them to create an account first.

The admin pages explicitly reject profiles whose role is not `admin`. Distributor pages require authentication but currently do not explicitly verify `role === "distributor"`.

### 7. Navigation behavior

`src/navigation/globalNavigationManager.js` synchronizes dashboard screens with optional URL tabs. Examples:

```text
/crunzzo/distributor/home
/crunzzo/distributor/history
/bounce/admin/inventory
/valencia/admin/products
```

The root distributor screen is `home`; the root admin screen is `dashboard`. The hook writes custom entries to `window.history` so browser Back/Forward follows internal screens. Pressing Back from a portal root opens a logout confirmation instead of immediately leaving. Logout signs out from the current brand and returns to `/choose-section`.

### 8. Distributor portal workflow

All distributor portals use the same overall screens:

```text
home -> customer -> products -> summary -> success
          |             |
          +-------------+ validation may send the user back

Additional screens: history and profile
```

#### Home

- Greets the signed-in distributor.
- Starts a new sale.
- Shows today's sales value and units sold.
- Shows the three most recent orders.
- Bottom navigation links to Home, Inventory/Product Selection, History, and Profile.

#### Customer details

Required fields:

- Shop name
- 10-digit phone number
- GST number, except Crunzzo accepts either GST or PAN
- 6-digit sales pincode

GST format follows the standard 15-character Indian GST pattern. Crunzzo also accepts a 10-character PAN pattern.

#### Product selection

- Reads active products in real time from Firestore.
- Builds category tabs from product data.
- Supports product-name search.
- Prevents cart quantity from exceeding the available stock model.
- Uses a brand-specific packaging model described below.

#### Order summary

- Lists selected products and quantities.
- Re-validates customer fields.
- Shows subtotal, discount, tax, and final total.
- Can download a preview invoice before order submission.
- Submits the sale to Firestore.

#### Success

- Shows the shop, invoice number, time, quantity, and total.
- Downloads the saved invoice.
- Opens `wa.me` in a new tab with a brand-specific order confirmation message.

#### History

- Only queries orders where `distributorUid` equals the logged-in user's UID.
- Sorts newest first using `createdAtMs`.
- Filters by All Time, Today, This Week, This Month, or a custom date range.
- Searches by shop name or order document ID.
- Shows the filtered total.

#### Profile

- Edits name, business name, phone, territory, and profile photo.
- Uploads photos to `profiles/{uid}/...` in Firebase Storage.
- Shows performance cards and links to inventory/history.
- The displayed `12%` and `8%` growth indicators are currently hardcoded, not calculated.
- **Help & Support** currently has an empty click handler.

### 9. Shared sale calculations

For Bounce and Valencia:

```js
subtotal = sum(line totals)
wholesaleDiscount = subtotal * 0.05
taxableValue = subtotal - wholesaleDiscount
tax = taxableValue * 0.08
total = taxableValue + tax
```

This fixed 8% tax does not use the GST percentage stored on the product.

For Crunzzo:

```js
subtotal = sum(pack line totals)
wholesaleDiscount = subtotal * 0.05
taxableValue = subtotal - wholesaleDiscount
weightedGstRate = weighted average of item GST by line value
tax = taxableValue * weightedGstRate / 100
total = taxableValue + tax
```

Currency is formatted as Indian rupees with the `en-IN` locale. Compact admin values use K, L, and Cr suffixes.

### 10. Brand-specific product and stock models

#### Bounce

- Simplest model: one product document represents one sellable unit/SKU.
- Cart quantity directly consumes `product.stock`.
- Rate is `product.rate`.
- Default categories: Club Soda, Hemp Based, Iced Tea, Soda, Energy Drink, Juice.
- Default zones: Chennai, Hyderabad, Tamil Nadu, Karnataka.
- Admin can increment/decrement stock one unit at a time.
- On sale, the order is created first with `addDoc`. Product stock is then updated one product at a time as a best-effort operation.
- If stock updates fail because of permissions or another error, the order remains saved and the UI still treats it as successful. This can make orders and inventory inconsistent and allows race conditions/overselling.

#### Valencia

- A product stores total individual cans/units in `product.stock` and a base one-can `rate`.
- Distributor packaging choices are generated in the UI:

```text
1 X 250 ml  -> 1 unit
4 X 250 ml  -> 4 units
6 X 250 ml  -> 6 units
12 X 250 ml -> 12 units
24 X 250 ml -> 24 units
```

- Package price is `base rate * unit count`.
- The cart tracks product plus option, while stock checks aggregate all selected packages back into total cans.
- Default categories: Energy Drinks, Hemp Based, Iced Tea, Sparkling, Soda.
- Default zones: Mumbai, Pune, Delhi, Hyderabad.
- Order creation and all stock deductions run in one Firestore transaction. The transaction fails if a product is missing or has insufficient stock.

#### Crunzzo

- Products use configurable fixed snack packs, defined in `src/utils/crunzzoPacks.js`.
- Default pack definitions are Pack of 12 and Pack of 240, but admin can change each pack size.
- Each pack has its own rate and pricing group; GST is shared from the product form.
- The product's top-level `stock` is total individual units, while normalized pack availability is `floor(total units / pack size)`.
- Cart keys combine product ID and pack ID.
- A sale deducts `quantity * packSize` total units.
- Default categories: Chips, Puffs, Namkeen, Masala, Snacks.
- Default zones: Chennai, Hyderabad, Tamil Nadu, Karnataka.
- Order creation and grouped product stock deductions run in one Firestore transaction.
- Admin analytics aggregate actual units sold and sales value by SKU.
- Admin pincode analytics call `https://api.postalpincode.in/pincode/{pincode}` when an order has no saved city. Resolved cities are cached in local storage under `crunzzo_pincode_city_cache_v1`; three pincodes also have hardcoded area overrides.

### 11. Order document shape

All brands save a snapshot of product/customer data so historical orders do not depend on current product names or prices.

Common order fields are approximately:

```js
orders/{orderId} = {
  invoiceNumber: `INV-${timestamp}`,
  distributorUid,
  distributorName,
  distributorId,
  shopName,
  phone,
  gst,
  salesPincode,
  pincode,
  subtotal,
  wholesaleDiscount,
  tax,
  total,
  totalUnits,
  itemCount,
  items: [],
  createdAt: serverTimestamp(),
  createdAtMs: Date.now(),
  timeLabel
}
```

Valencia additionally stores `brand: "drinkvalencia"`.

Bounce item fields:

```js
{
  productId,
  name,
  category,
  quantity,
  unitLabel,
  rate,
  rateLabel,
  lineTotal,
  imageUrl
}
```

Valencia adds `optionId`, `optionLabel`, and `unitCount`.

Crunzzo adds `packId`, `packLabel`, `packSize`, `totalUnits`, and item GST.

### 12. Product document shape

Common product fields created by admin are approximately:

```js
products/{productId} = {
  name,
  rate,
  price,                 // used on some updates/legacy compatibility
  pricingGroup,
  gst,
  description,
  skuCode,
  unitLabel,
  stock,
  openingStock,
  lowStockThreshold,
  category,
  zones: [],
  imageUrl,
  status: "active" | "inactive",
  createdAt: serverTimestamp(),
  createdAtMs: Date.now(),
  updatedAtMs            // present after some edits
}
```

Crunzzo also stores:

```js
{
  packSellingMode: "fixed-packs",
  packOptions: [
    {
      id,
      label,
      packSize,
      rate,
      price,
      pricingGroup,
      gst,
      stock,
      openingStock,
      lowStockThreshold
    }
  ]
}
```

The top-level Crunzzo `stock` remains the authoritative total-unit count. Derived pack stocks can become stale and are normalized from total stock when read.

### 13. Admin portal

Admin navigation has these tabs:

- **Dashboard**
- **Sales**
- **Products**
- **Inventory**
- **Profile**, opened from the header avatar and not shown as a bottom tab

#### Dashboard analytics

- Total sales across all orders
- Order count
- Total stock available
- Top-performing SKU
- Sales distribution by pincode
- Additional top-performing SKUs

Inventory value is generally `stock * rate`; Crunzzo estimates per-unit value from its primary pack rate and pack size.

#### Sales

- Reads every order for the selected brand in real time.
- Uses the shared date filter.
- Searches shop name, distributor name, or distributor ID.
- Displays filtered transaction count and total value.

#### Products

Admin can create products with:

- Required name
- Required image
- Required rate for Bounce/Valencia
- Required rates for every Crunzzo pack
- Pricing group
- GST
- Description
- SKU code
- Unit label where applicable
- Opening stock
- Low-stock threshold
- Category, including a modal to add a new category
- Distribution zones, selected from defaults or typed manually

Images are uploaded under `products/...` in the brand Storage bucket. Categories typed in the modal are component state until a product using that category is saved; saved product categories repopulate the available list later.

#### Inventory

- Shows product count, low-stock count, and inventory value.
- Searches name, category, and SKU.
- Shows product image, price, stock, and status.
- Can toggle active/inactive and delete products.
- Bounce and Valencia can increment/decrement stock.
- Bounce and Valencia inline editing only changes product name and rate.
- Crunzzo editing can update name, category, SKU, total stock, GST, low-stock threshold, pack sizes, pack rates, and pack pricing groups.
- Deleting a product does not delete its uploaded Storage image and does not modify historical order snapshots.

#### Admin profile

- Edits name, business name, phone, territory, and image.
- Shows all-time sales/order count plus inventory value/low-stock count.
- Links to dashboard, sales, inventory, and product setup.
- Help & Support is currently a no-op.

### 14. Shared components and important files

```text
src/main.jsx                                  React bootstrap
src/App.jsx                                   Route table
src/firebase/index.js                         Three named Firebase apps/services
src/navigation/globalNavigationManager.js     URL/history synchronization and logout guard
src/pages/LandingPage.jsx                     Public landing page
src/pages/ChooseSectionPage.jsx               Brand selection
src/pages/LoginPage.jsx                       Shared brand-aware login/signup
src/components/HistoryDateFilter.jsx          Presets and custom date-range picker
src/components/AdminProfileEditor.jsx         Shared admin profile screen
src/components/AdminProductEditPanel.jsx      Simple Bounce/Valencia name/rate editor
src/components/CategoryModal.jsx               Add-category modal
src/utils/crunzzoPacks.js                      Crunzzo pack normalization and valuation
src/pages/{brand}/*DistributorDashboard.jsx    Distributor workflows
src/pages/{brand}/*AdminDashboard.jsx          Admin workflows
src/pages/{brand}/{brand}.css                  Distributor/mobile styles
src/pages/{brand}/{brand}-admin.css            Admin-specific styles
```

Several older brand-specific landing/login/choose files are empty or thin wrappers and are not used by `App.jsx`.

### 15. UI and responsive design

- The interface is strongly mobile-first and resembles a phone app.
- Public, login, distributor, and admin shells have a maximum width of about 430px on desktop.
- Desktop centers the narrow app shell on a light background.
- At widths of 480px or less, the shell becomes full-screen and uses `100vh`/`100dvh`.
- Distributor screens use fixed/sticky bottom navigation patterns.
- The global stylesheet hides scrollbars.
- Visual identity is mostly shared layout plus brand color overrides: orange Valencia, blue Bounce, red Crunzzo.
- The current landing page is Valencia-branded even though it leads to all three brands.

### 16. Invoice behavior

Invoices are generated entirely in the browser as escaped HTML strings. Download creates a Blob and saves an `.html` file named after the invoice number. The app does not generate PDF files and has no server-side invoice service. Invoice data includes shop/customer details, distributor, timestamp, item rows, subtotal, discount, tax, and grand total.

### 17. Real-time data behavior

- Products and orders are read with Firestore `onSnapshot` listeners.
- Admin listens to all products and all orders for its brand.
- Distributor listens to all products but only its own orders.
- Distributor product lists hide documents whose status is `inactive`.
- Sorting uses numeric `createdAtMs`, newest first.
- The UI stores forms, filters, cart state, and current screen in local React component state.

### 18. Current limitations and risks

Treat these as important facts when suggesting changes:

1. **Authorization depends on Firestore/Storage rules that are not in the repository.** Client-side role checks are not a security boundary.
2. **Distributor dashboards do not explicitly enforce the distributor role.** Any authenticated profile in that brand may reach them if database rules permit it.
3. **Admin subscriptions start before the rendered role rejection.** Firestore rules must prevent non-admin reads/writes.
4. **Bounce order/stock updates are non-atomic.** Orders can exist without matching stock deductions, and concurrent sales can oversell.
5. **Bounce and Valencia ignore stored product GST during checkout.** They apply a fixed 8% tax.
6. **No tests, linting, CI workflow, Firebase rules, or emulator setup are present.**
7. **There is extensive duplication across six large dashboard files.** Brand differences are mixed with repeated workflow/UI code.
8. **No route-level lazy loading exists.** The production JavaScript bundle is about 886 KB minified, and Vite warns that it exceeds 500 KB.
9. **The landing hero is about 6.55 MB.** This can hurt mobile startup performance.
10. **Profile growth percentages are hardcoded.** They should not be treated as real analytics.
11. **Help & Support does nothing.**
12. **WhatsApp phone numbers are passed directly to `wa.me`.** There is no country-code normalization.
13. **Product deletion leaves orphaned Storage images.**
14. **Firebase configuration is committed in frontend source.** Firebase web API keys are normally public identifiers, but strong rules and domain restrictions are still essential.
15. **The selected backend local-storage helper is mostly redundant.** Dashboards request their backend directly.
16. **Signup immediately activates a distributor.** There is no admin approval/onboarding workflow.
17. **Deployment configuration may need review.** Vite currently uses `base: "/"`; this only works for root-hosted deployments unless hosting rewrites/assets are configured accordingly.

### 19. Current verification status

The public landing, section selection, login, and signup screens were opened in a browser. Unauthenticated dashboard URLs correctly redirected to `/choose-section`. Authenticated dashboards were analyzed from source because no test credentials were supplied and creating or modifying live Firebase accounts/data was not authorized.

`npm run build` succeeds with Vite 8.0.9. It reports a large-chunk warning. There are currently no repository tests to run.

### 20. Rules for future work on this app

When proposing or implementing changes:

- Preserve brand isolation between the three Firebase projects.
- Preserve role-specific behavior and verify authorization in Firebase rules, not only React.
- Preserve historical order snapshots even if products change later.
- Use Firestore transactions for any operation that creates an order and reduces stock.
- State clearly whether stock means sellable packs or individual base units.
- Keep Crunzzo total units as the authoritative stock quantity and derive pack availability from it.
- Keep Valencia stock as individual cans and convert packaging options to unit deductions.
- Avoid changing checkout tax behavior silently; tax/GST is business-critical.
- Prefer shared components/hooks/services for duplicated distributor/admin behavior, but keep brand-specific policies configurable.
- Add tests around validation, pricing, tax, stock limits, transactions, date filtering, role routing, and pack conversion before major refactoring.
- Do not assume that UI-hidden operations are secure without Firestore and Storage rules.
- Verify mobile layouts at 430px and below.

Use this context to answer the user's next request. If the request conflicts with an existing business rule, identify the conflict before changing code. If important Firebase rules or production data are required but unavailable, state the uncertainty instead of inventing them.

---

## End Of Prompt
