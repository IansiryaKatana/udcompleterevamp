/** Shared marketing page HTML for static CMS fallback and migration seeds. */

export const LEGAL_PAGES = {
  privacy: {
    title: 'Privacy Policy',
    slug: 'privacy',
    metaDescription: 'How Unique Distribution collects, uses, and protects your personal data.',
    bodyHtml: `<h2>Who we are</h2>
<p>Unique Distribution operates this wholesale trade platform for UK retailers. This policy explains how we handle your personal information when you browse, request a quote, apply for a trade account, or place an order.</p>
<h2>Information we collect</h2>
<ul>
<li><strong>Account &amp; checkout:</strong> name, email address, shipping address, phone number, and order history.</li>
<li><strong>Quote requests:</strong> cart contents, contact details, and any notes you provide.</li>
<li><strong>Trade applications:</strong> business details submitted through the trade form.</li>
<li><strong>Support:</strong> messages sent through our contact form or email.</li>
<li><strong>Newsletter:</strong> email address when you subscribe.</li>
<li><strong>Technical data:</strong> IP address, browser type, device information, and cookies (see our <a href="/pages/cookies">Cookie Policy</a>).</li>
</ul>
<h2>How we use your data</h2>
<p>We use your information to process orders and quotes, deliver products, provide customer support, prevent fraud, improve our website, and—where you have opted in—send marketing emails. We rely on contract performance, legitimate interests, and consent where required by law.</p>
<h2>Sharing your data</h2>
<p>We share data only with trusted processors that help us operate the store, including payment providers where enabled, email delivery services, shipping carriers, and hosting providers. We do not sell your personal data.</p>
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
    metaDescription: 'Terms and conditions for trading with Unique Distribution.',
    bodyHtml: `<h2>Agreement</h2>
<p>By using uniquedistribution.com you agree to these terms. If you do not agree, please do not use our site.</p>
<h2>Products &amp; pricing</h2>
<p>We supply wholesale products to trade customers, including vapes, nicotine products, confectionery, drinks, accessories and retail essentials. Trade pricing and checkout eligibility follow Unique commercial policy. Prices are shown in the currency configured at checkout. We may correct pricing errors before accepting an order. Product images are representative; specifications are listed on each product page.</p>
<h2>Quotes &amp; orders</h2>
<p>When quote checkout is enabled, submitting a cart creates a quote request—not a binding contract—until we confirm availability and final pricing. Paid card orders, when a payment gateway is operational, are confirmed when payment succeeds.</p>
<h2>Payment</h2>
<p>Available payment options are those Unique enables for your account. PAY LATER is only offered when Unique marks the account eligible. Historical payment tags do not grant access.</p>
<h2>Shipping &amp; risk</h2>
<p>Delivery terms are described in our <a href="/pages/shipping">Delivery information</a>. Title and risk pass to you upon delivery to the carrier unless otherwise required by law.</p>
<h2>Returns</h2>
<p>Unopened items in resaleable condition may be returned within 14 days of delivery unless excluded. Faulty items should be raised with your order number. Unique does not invent additional statutory rights here.</p>
<h2>Limitation of liability</h2>
<p>To the fullest extent permitted by law, Unique Distribution is not liable for indirect or consequential loss. Nothing in these terms limits rights that cannot be excluded by law.</p>
<h2>Governing law</h2>
<p>These terms are governed by the laws of England and Wales. Disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales unless mandatory law provides otherwise.</p>`,
  },
  shipping: {
    title: 'Delivery information',
    slug: 'shipping',
    metaDescription: 'Delivery information for Unique Distribution wholesale orders.',
    bodyHtml: `<p>Unique Distribution supplies UK trade customers. Delivery options, cut-offs and Saturday arrangements are confirmed with your account or quote — Unique’s native carrier integration is not live on this platform yet.</p>
<p>The live Unique Distribution business currently publishes next-working-day dispatch for qualifying orders placed on weekdays by 16:00, with Saturday delivery arranged through your account manager. Treat those as Unique’s current published trade terms until this platform’s own fulfilment settings are confirmed.</p>
<p>Tracking appears on your order only after a shipment has actually been created. This site does not show Unique DPD tracking while carrier mode is disabled.</p>
<p>Questions: <a href="/pages/contact">contact support</a>.</p>`,
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
    title: 'Contact Unique Distribution',
    slug: 'contact',
    metaDescription: 'Trade enquiries, order support and general contact for Unique Distribution.',
    bodyHtml: `<p>Use this form for trade enquiries, order or account support, and general questions. Include your trading name and order reference where relevant.</p>`,
  },
  about: {
    title: 'About Unique Distribution',
    slug: 'about',
    metaDescription: 'Unique Distribution is a UK wholesale distributor and retail supply partner.',
    bodyHtml: `<p>Unique Distribution is a UK wholesale distributor supplying retailers with vapes, nicotine products, confectionery, drinks, accessories and retail essentials from one trade platform.</p>
<p>We are a supply partner for shops — not a consumer lifestyle store. Trade customers can browse the catalogue, request quotes, and apply for a Unique trade account.</p>
<p>When you work with Unique you gain a catalogue built for restocking, not end-user browsing.</p>`,
  },
  help: {
    title: 'Help & support',
    slug: 'help',
    metaDescription: 'Help with Unique Distribution orders, trade accounts, quotes and delivery.',
    bodyHtml: `<p>Need help with an order, trade application, delivery question or account issue? Contact Unique Distribution and our team will point you to the right place.</p>
<ul>
<li><strong>Orders:</strong> sign in to your account for recent orders, or contact us with your order reference.</li>
<li><strong>Trade applications:</strong> apply at <a href="/trade">Open a trade account</a>.</li>
<li><strong>Quotes:</strong> request a quote from a product, your cart, or checkout.</li>
<li><strong>Delivery:</strong> see <a href="/pages/shipping">Delivery information</a>.</li>
<li><strong>Compliance:</strong> <a href="/pages/tpd-compliance">TPD compliance</a>, <a href="/pages/modern-slavery-statement">Modern slavery statement</a>, and <a href="/pages/medical-info-disclaimer">Medical information disclaimer</a>.</li>
</ul>
<p><a href="/pages/contact">Contact Unique Distribution</a></p>`,
  },
  tpd: {
    title: 'TPD Compliance',
    slug: 'tpd-compliance',
    metaDescription: 'Unique Distribution TPD compliance information for trade customers.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published page at uniquedistribution.com/pages/tpd-compliance. Not rewritten.</em></p>
<h2>TPD Compliance at Unique Distribution</h2>
<p>At Unique Distribution, we are committed to ensuring the highest level of compliance with regulations governing our products. As a leading supplier of vapes and confectioneries, we understand the importance of adhering to industry standards and guidelines.</p>
<p>In 2016, the European Union introduced the Tobacco Products Directive (TPD), which aimed to reduce the risks associated with tobacco use by regulating e-cigarettes and other nicotine-containing products. The TPD set out strict rules for the design, manufacture, and sale of these products, including requirements for labeling, packaging, and advertising. At Unique Distribution, we take our responsibility as a responsible supplier seriously. We have implemented rigorous quality control measures to ensure that all our vape and confectionery products meet or exceed the standards outlined in the TPD. Our team is dedicated to ensuring that every product leaving our warehouse meets the highest levels of safety, efficacy, and compliance.</p>
<h2>Some key aspects of our TPD compliance include:</h2>
<ul>
<li><strong>Labeling and Packaging:</strong> We ensure that all packaging and labeling comply with EU regulations, including warnings, ingredient lists, and nutritional information.</li>
<li><strong>Product Design:</strong> Our products are designed to meet or exceed TPD guidelines for size, shape, and functionality.</li>
<li><strong>Advertising and Promotion:</strong> We adhere strictly to advertising and promotional guidelines set out in the TPD, avoiding any misleading or deceptive claims.</li>
</ul>
<h2>Your Partner in Compliance</h2>
<p>At Unique Distribution, we pride ourselves on being a reliable partner for businesses seeking high-quality vape and confectionery products that meet the highest standards of compliance. Contact us today to learn more about how our commitment to TPD compliance can benefit your business.</p>`,
  },
  modernSlavery: {
    title: 'Modern Slavery Statement',
    slug: 'modern-slavery-statement',
    metaDescription: 'Unique Distribution ethical trading and modern slavery statement.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published page at uniquedistribution.com/pages/modern-slavery-statement. Not rewritten.</em></p>
<p><strong>Scope:</strong> This policy applies to all employees, contractors, and suppliers of Unique Distribution. We expect our suppliers to align with our commitment to ethical trading and modern slavery prevention.</p>
<h2>Principles</h2>
<p><strong>Respect for Human Rights:</strong> Unique Distribution is devoted to respecting and supporting human rights throughout our operations and supply chain. This includes ensuring fair and safe working conditions, freedom of association, and the prohibition of discrimination.</p>
<p><strong>Labour Standards:</strong> We follow internationally recognized labor standards, as defined by organizations such as the International Labour Organization (ILO). Our commitment involves ensuring that our suppliers provide fair wages, reasonable working hours, and a safe and healthy work environment.</p>
<p><strong>Reporting and Non-Compliance:</strong> Suppliers are encouraged to report any concerns about unethical or non-compliant practices within our supply chain. Unique Distribution will investigate reported cases thoroughly and take appropriate corrective measures.</p>
<p><strong>Supply Chain Transparency:</strong> We expect our suppliers to be transparent about their supply chains. We encourage them to disclose information about the origins of their materials and the conditions under which their products are made.</p>
<p><strong>Due Diligence:</strong> Unique Distribution will carry out due diligence to identify and assess potential risks of modern slavery within our supply chain. This includes conducting regular audits and assessments of our suppliers’ practices to ensure adherence to this policy.</p>
<p><strong>No Forced Labour:</strong> Unique Distribution strictly bans the use of forced or compulsory labor in our supply chain. This encompasses all forms of bonded labor, human trafficking, and modern slavery.</p>
<p><strong>Child Labour:</strong> We do not tolerate child labor in our supply chain. Suppliers must adhere to national and international laws regarding the minimum age for employment.</p>
<p><strong>Training:</strong> We will provide training to our employees and suppliers on ethical trading and modern slavery prevention. This training will cover recognizing signs of modern slavery and the procedures for reporting concerns.</p>
<p><strong>Review and Continuous Improvement:</strong> This policy will be reviewed regularly to ensure its effectiveness and relevance. Unique Distribution is committed to continually improving our ethical trading practices and preventing modern slavery.</p>
<p>By adhering to this Ethical Trading and Modern Slavery Policy, Unique Distribution aims to foster a fair and just global business environment. We believe that conducting business ethically is both a legal obligation and a moral responsibility.</p>`,
  },
  medicalDisclaimer: {
    title: 'Medical Information Disclaimer',
    slug: 'medical-info-disclaimer',
    metaDescription: 'Unique Distribution medical information disclaimer.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published page at uniquedistribution.com/pages/medical-info-disclaimer. Not rewritten.</em></p>
<h2>The following statements apply to all content on our website:</h2>
<p><strong>No Medical Advice:</strong> The information provided by Unique Distribution should not be considered as a substitute for professional medical advice or treatment.</p>
<p><strong>Product Information Only:</strong> Our products are designed to provide nicotine-free alternatives to traditional tobacco products. While we strive to ensure the accuracy of product descriptions, ingredients, and usage guidelines, this information is intended solely for educational purposes and should not be relied upon for making informed decisions about your health.</p>
<h2>Important Notice</h2>
<p>If you experience any adverse effects or concerns related to our products, please consult a healthcare professional immediately. We cannot provide medical advice or treatment recommendations under any circumstances. By accessing and using the content on this website, you acknowledge that: You have read, understood, and agree to these terms. You will not rely solely on information provided by Unique Distribution for making decisions about your health. You understand that our products are designed for adult use only (18+ years) and should be used responsibly.</p>
<h2>Disclaimer</h2>
<p>Unique Distribution disclaims any liability or responsibility for:</p>
<ul>
<li>Any adverse effects resulting from the misuse, overuse, or underuse of our products.</li>
<li>Injuries or illnesses caused by failure to follow product instructions or warnings.</li>
<li>Misinterpretation or misunderstanding of information provided on this website.</li>
</ul>
<p>By using our website and purchasing our products, you acknowledge that you have read, understood, and agree to these terms. If you are unsure about any aspect of our products or their use, please consult a healthcare professional before proceeding.</p>
<h2>Your Health Matters</h2>
<p>At Unique Distribution, we prioritize your health and well-being above all else. We encourage responsible product usage and recommend consulting with a healthcare professional if you have concerns about the suitability of our products for your individual needs. Remember: Our products are designed to provide nicotine-free alternatives to traditional tobacco products. If you experience any adverse effects or concerns related to their use, please seek medical attention immediately.</p>`,
  },
} as const
