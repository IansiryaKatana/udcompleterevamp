/** Shared marketing page HTML for static CMS fallback and migration seeds. */

export const LEGAL_PAGES = {
  privacy: {
    title: 'Privacy Policy',
    slug: 'privacy',
    metaDescription: 'How Unique Distribution collects, uses, and protects your personal data.',
    bodyHtml: `<h2>Who we are</h2>
<p>Unique Distribution operates this online store for components, phones, consoles, and related accessories. This policy explains how we handle your personal information when you browse, request a quote, or place an order.</p>
<h2>Information we collect</h2>
<ul>
<li><strong>Account &amp; checkout:</strong> name, email address, shipping address, phone number, and order history.</li>
<li><strong>Quote requests:</strong> cart contents, contact details, and any notes you provide.</li>
<li><strong>Support:</strong> messages sent through our contact form or email.</li>
<li><strong>Newsletter:</strong> email address when you subscribe.</li>
<li><strong>Technical data:</strong> IP address, browser type, device information, and cookies (see our <a href="/pages/cookies">Cookie Policy</a>).</li>
</ul>
<h2>How we use your data</h2>
<p>We use your information to process orders and quotes, deliver products, provide customer support, prevent fraud, improve our website, and—where you have opted in—send marketing emails. We rely on contract performance, legitimate interests, and consent where required by law.</p>
<h2>Sharing your data</h2>
<p>We share data only with trusted processors that help us operate the store, including payment providers (Stripe), email delivery services, shipping carriers, and hosting providers. We do not sell your personal data.</p>
<h2>Retention</h2>
<p>Order and tax records are kept as required by law. Marketing preferences are kept until you unsubscribe. Contact form submissions are retained for support and audit purposes.</p>
<h2>Your rights (GDPR &amp; UK GDPR)</h2>
<p>If you are in the UK or EEA, you may request access, correction, deletion, restriction, portability, or object to certain processing. You may withdraw consent at any time and lodge a complaint with your local data protection authority.</p>
<p>To exercise your rights, contact us via our <a href="/pages/contact">contact page</a>.</p>
<h2>Security</h2>
<p>We use encryption in transit (HTTPS), access controls, and industry-standard practices to protect your data. No method of transmission over the internet is 100% secure.</p>
<h2>Changes</h2>
<p>We may update this policy from time to time. The latest version will always be published on this page.</p>`,
  },
  terms: {
    title: 'Terms of Service',
    slug: 'terms',
    metaDescription: 'Terms and conditions for shopping with Unique Distribution.',
    bodyHtml: `<h2>Agreement</h2>
<p>By using uniquedistribution.com you agree to these terms. If you do not agree, please do not use our site.</p>
<h2>Products &amp; pricing</h2>
<p>We sell new and refurbished electronics including PC components, mobile devices, and gaming hardware. Prices are shown in the currency configured at checkout. We may correct pricing errors before accepting an order. Product images are representative; specifications are listed on each product page.</p>
<h2>Quotes &amp; orders</h2>
<p>When quote checkout is enabled, submitting a cart creates a quote request—not a binding contract—until we confirm availability and final pricing. Paid orders through Stripe are confirmed when payment succeeds.</p>
<h2>Payment</h2>
<p>We accept major cards and digital wallets through our payment partners. You confirm that you are authorised to use the payment method provided.</p>
<h2>Shipping &amp; risk</h2>
<p>Delivery terms are described in our <a href="/pages/shipping">Shipping Information</a>. Title and risk pass to you upon delivery to the carrier unless otherwise required by law.</p>
<h2>Returns</h2>
<p>Unopened items in resaleable condition may be returned within 14 days of delivery unless excluded (e.g. opened software, personalised builds, or hygiene-sensitive accessories). Faulty items are covered under applicable consumer warranty laws—contact us with your order number.</p>
<h2>Limitation of liability</h2>
<p>To the fullest extent permitted by law, Unique Distribution is not liable for indirect or consequential loss. Nothing in these terms limits your statutory consumer rights.</p>
<h2>Governing law</h2>
<p>These terms are governed by the laws of England and Wales. Disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales unless mandatory consumer law provides otherwise.</p>`,
  },
  shipping: {
    title: 'Shipping Information',
    slug: 'shipping',
    metaDescription: 'Delivery times, carriers, and shipping policies for Unique Distribution orders.',
    bodyHtml: `<h2>Processing time</h2>
<p>Orders are typically processed within 1–2 business days. Custom quotes, pre-built systems, and high-value GPUs may require additional verification before dispatch.</p>
<h2>UK delivery</h2>
<ul>
<li><strong>Standard (2–4 business days):</strong> tracked courier for most components and accessories.</li>
<li><strong>Express (1–2 business days):</strong> available at checkout where offered.</li>
<li><strong>Large items:</strong> gaming PCs and bulky shipments may use pallet or specialist courier services.</li>
</ul>
<h2>International shipping</h2>
<p>We ship to selected countries. Import duties, taxes, and customs fees are the responsibility of the recipient unless stated otherwise at checkout.</p>
<h2>Fragile &amp; high-value items</h2>
<p>Graphics cards, processors, and pre-built systems are packed with anti-static and shock protection. Signature confirmation may be required on orders over £500.</p>
<h2>Tracking</h2>
<p>You will receive a shipping confirmation email with tracking details when your order leaves our warehouse.</p>
<h2>Lost or damaged parcels</h2>
<p>Contact us within 48 hours of delivery if your package arrives damaged or does not arrive within the expected window. We will work with the carrier to resolve the issue.</p>
<h2>Quote orders</h2>
<p>Shipping costs for quote-based orders are confirmed in writing before payment is taken.</p>`,
  },
  cookies: {
    title: 'Cookie Policy',
    slug: 'cookies',
    metaDescription: 'How Unique Distribution uses cookies and similar technologies.',
    bodyHtml: `<h2>What are cookies?</h2>
<p>Cookies are small text files stored on your device when you visit our website. They help the store function, remember preferences, and—if you consent—understand how visitors use our site.</p>
<h2>How we use cookies</h2>
<h3>Strictly necessary (always active)</h3>
<p>Required for the site to work. These include session cookies for your shopping cart, authentication, checkout security, and storing your cookie consent choice. You cannot opt out of these cookies.</p>
<h3>Analytics (optional)</h3>
<p>Help us understand traffic and improve product discovery. We only enable these if you accept analytics cookies in our consent banner.</p>
<h3>Marketing (optional)</h3>
<p>Used to measure newsletter sign-ups and campaign performance. We only enable these if you accept marketing cookies.</p>
<h2>Similar technologies</h2>
<p>We may use local storage for cart contents and consent preferences. These are not cookies but serve a similar purpose and are covered by this policy.</p>
<h2>Managing cookies</h2>
<p>You can change your preferences at any time using <strong>Cookie settings</strong> in the site footer or your browser settings. Blocking all cookies may prevent checkout and account features from working.</p>
<h2>Third parties</h2>
<p>Payment processors and embedded content may set their own cookies when you interact with their services. Please review their privacy policies for details.</p>
<h2>Updates</h2>
<p>We may revise this policy when we add features or change providers. Material changes will be reflected on this page.</p>`,
  },
  contact: {
    title: 'Contact Us',
    slug: 'contact',
    metaDescription: 'Get in touch with Unique Distribution for quotes, orders, and product support.',
    bodyHtml: `<p>Questions about compatibility, bulk orders, shipping, or an existing purchase? Send us a message and our team will respond within one business day.</p>`,
  },
} as const
