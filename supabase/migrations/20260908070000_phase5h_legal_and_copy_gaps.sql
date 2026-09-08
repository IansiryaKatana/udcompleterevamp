-- Phase 5H remaining storefront gaps.
-- COPY-FROM-LIVE Unique legal pages + leftover electronics copy.
-- Does NOT flip commercial / compliance / gateway / WMS / pilot locks.

insert into public.marketing_pages (id, title, slug, body_html, meta_description, published, sort_order)
values
(
  'b1111111-5a00-4000-8000-000000000010',
  'TPD Compliance',
  'tpd-compliance',
  $html$<p><em>Migrated from Unique Distribution’s published page at uniquedistribution.com/pages/tpd-compliance. Not rewritten.</em></p>
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
<p>At Unique Distribution, we pride ourselves on being a reliable partner for businesses seeking high-quality vape and confectionery products that meet the highest standards of compliance. Contact us today to learn more about how our commitment to TPD compliance can benefit your business.</p>$html$,
  'Unique Distribution TPD compliance information for trade customers.',
  true,
  20
),
(
  'b1111111-5a00-4000-8000-000000000011',
  'Modern Slavery Statement',
  'modern-slavery-statement',
  $html$<p><em>Migrated from Unique Distribution’s published page at uniquedistribution.com/pages/modern-slavery-statement. Not rewritten.</em></p>
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
<p>By adhering to this Ethical Trading and Modern Slavery Policy, Unique Distribution aims to foster a fair and just global business environment. We believe that conducting business ethically is both a legal obligation and a moral responsibility.</p>$html$,
  'Unique Distribution ethical trading and modern slavery statement.',
  true,
  21
),
(
  'b1111111-5a00-4000-8000-000000000012',
  'Medical Information Disclaimer',
  'medical-info-disclaimer',
  $html$<p><em>Migrated from Unique Distribution’s published page at uniquedistribution.com/pages/medical-info-disclaimer. Not rewritten.</em></p>
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
<p>At Unique Distribution, we prioritize your health and well-being above all else. We encourage responsible product usage and recommend consulting with a healthcare professional if you have concerns about the suitability of our products for your individual needs. Remember: Our products are designed to provide nicotine-free alternatives to traditional tobacco products. If you experience any adverse effects or concerns related to their use, please seek medical attention immediately.</p>$html$,
  'Unique Distribution medical information disclaimer.',
  true,
  22
)
on conflict (slug) do update set
  title = excluded.title,
  body_html = excluded.body_html,
  meta_description = excluded.meta_description,
  published = true,
  sort_order = excluded.sort_order;

update public.marketing_pages
set body_html = $html$<p>Need help with an order, trade application, delivery question or account issue? Contact Unique Distribution and our team will point you to the right place.</p>
<ul>
<li><strong>Orders:</strong> sign in to your account for recent orders, or contact us with your order reference.</li>
<li><strong>Trade applications:</strong> apply at <a href="/trade">Open a trade account</a>.</li>
<li><strong>Quotes:</strong> request a quote from a product, your cart, or checkout.</li>
<li><strong>Delivery:</strong> see <a href="/pages/shipping">Delivery information</a>.</li>
<li><strong>Compliance:</strong> <a href="/pages/tpd-compliance">TPD compliance</a>, <a href="/pages/modern-slavery-statement">Modern slavery statement</a>, and <a href="/pages/medical-info-disclaimer">Medical information disclaimer</a>.</li>
</ul>
<p><a href="/pages/contact">Contact Unique Distribution</a></p>$html$
where slug = 'help';

insert into public.nav_links (id, label, href, location, sort_order, is_active)
values
  ('a1111111-5a00-4000-8000-000000000053', 'TPD Compliance', '/pages/tpd-compliance', 'footer_legal', 3, true),
  ('a1111111-5a00-4000-8000-000000000054', 'Modern Slavery', '/pages/modern-slavery-statement', 'footer_legal', 4, true),
  ('a1111111-5a00-4000-8000-000000000055', 'Medical disclaimer', '/pages/medical-info-disclaimer', 'footer_legal', 5, true)
on conflict (id) do update set
  label = excluded.label,
  href = excluded.href,
  location = excluded.location,
  sort_order = excluded.sort_order,
  is_active = true;

update public.collections
set description = 'Latest additions to the Unique wholesale catalogue.'
where slug = 'new'
  and (
    description ilike '%tech%'
    or description ilike '%electronics%'
    or description ilike '%top gear%'
  );

update public.collections
set title = 'Offers'
where slug = 'deals'
  and title ilike '%hot deals%';

update public.collections
set description = 'Featured wholesale offers currently merchandised in the catalogue.'
where slug = 'deals'
  and (
    description ilike '%tech%'
    or description ilike '%electronics%'
    or description ilike '%top gear%'
  );

insert into public.site_settings (key, value)
values (
  'default_delivery_info',
  $html$<p>The live Unique Distribution business currently publishes next-working-day dispatch for qualifying orders placed on weekdays by 16:00, with Saturday delivery arranged through your account manager. Treat those as Unique’s current published trade terms until this platform’s own fulfilment settings are confirmed.</p>
<p>Tracking appears on your order only after a shipment has actually been created. This site does not show Unique DPD tracking while carrier mode is disabled. See <a href="/pages/shipping">Delivery information</a>.</p>$html$
)
on conflict (key) do update
set value = excluded.value;
