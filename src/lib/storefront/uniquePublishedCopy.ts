/** Unique published storefront copy used by Unique OS. Not Unique-OS fulfilment policy. */

/** CMS keeps the provenance line; storefront pages do not display it. */
export function stripStorefrontMigrationNote(html: string) {
  return html.replace(/<p>\s*<em>\s*Migrated from Unique Distribution[\s\S]*?<\/em>\s*<\/p>\s*/gi, '')
}

export const UNIQUE_PUBLISHED_DELIVERY = [
  { title: 'Swift Delivery', detail: 'Next working day delivery' },
  { title: 'Same Day Dispatch', detail: 'Weekdays by 4:00PM' },
  { title: 'Saturday Delivery', detail: 'Speak to your account manager' },
] as const

export function uniqueRegisteredOfficeLine(settings: Record<string, string>) {
  const address = settings.contact_address?.trim() || '124 City Road, London, United Kingdom, EC1V 2NX'
  const legalName = settings.contact_company_legal_name?.trim() || 'UNIQUE WHOLESALE & DISTRIBUTION LIMITED'
  const number = settings.contact_company_number?.trim() || '15678913'
  return `You have to be over 18 to purchase from this website. Registered Office: UNIQUE DISTRIBUTION™, ${address} - Registered in England ${legalName} Registered UK Company Registration Number:${number}`
}

export const UNIQUE_FOOTER_PAGES = {
  careers: {
    title: 'Careers',
    slug: 'careers',
    metaDescription: 'Jobs at Unique Distribution — wholesale careers in the UK.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published page at uniquedistribution.com/pages/careers. Not rewritten.</em></p>
<h2>Join Our Team</h2>
<p>We're always looking for talented individuals to join our growing team. Explore our current openings below.</p>
<h2>About Our Company</h2>
<p>At Unique Distribution™, we specialize in supplying compliant vapes, e-liquids, shortfills, vape kits, coils, nicotine pouches, and accessories at competitive wholesale prices. We go beyond being a distributor, we are a strategic partner dedicated to helping vape shops, retail chains, and distributors grow profitably in a rapidly evolving industry.</p>
<h2>Why Join Unique Distribution?</h2>
<p>At Unique Distribution, we’re more than a vape distributor—we’re innovators, partners, and a team passionate about shaping the vaping industry. Here’s why you should join us:</p>
<ol>
<li><strong>Be Part of a Growing Industry</strong> — The vape market is evolving fast, and we’re at the forefront.</li>
<li><strong>Strong Partnerships</strong> — We value our partners—retailers, brands, and suppliers alike.</li>
<li><strong>Innovation &amp; Quality</strong> — We pride ourselves on offering premium vape products and solutions.</li>
<li><strong>Supportive Team Culture</strong> — Collaboration and respect are key.</li>
<li><strong>Career Growth &amp; Learning</strong> — Opportunities across sales, logistics, and operations.</li>
<li><strong>Make a Real Impact</strong> — Every role contributes to shaping the vaping experience for customers nationwide.</li>
</ol>
<h2>Unique Distribution Jobs</h2>
<p>Explore our departments below to see if any opportunities match your expertise. We’re always looking for talented individuals to join the Unique Distribution team.</p>
<h2>Sales Department</h2>
<p>Unique Distribution™ is always on the lookout for dynamic sales staff to help sell our huge range of products. Passion for vaping and the ability to talk with retailers across the country is a must.</p>
<ul>
<li>Territory Account Manager</li>
<li>Office Accounts Manager</li>
</ul>
<p>To enquire, <a href="/pages/contact">contact Unique Distribution</a>.</p>`,
  },
  vapingVsSmoking: {
    title: 'Vaping vs Smoking',
    slug: 'vaping-vs-smoking',
    metaDescription: 'The Great Debate: Vaping vs Smoking — Unique Distribution news.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published article at uniquedistribution.com/blogs/news/vaping-vs-smoking. Not rewritten.</em></p>
<h2>The Costly Truth: Vaping vs Smoking</h2>
<p>As the cost of cigarettes continues to rise, many smokers are feeling the pinch. Whether you're a fan of pre-rolled cigarettes or loose tobacco, the price increase is undeniable. This financial pressure is a significant factor driving people to quit smoking altogether. Enter vaping, an alternative that offers a potential solution to this problem.</p>
<h2>The Financial Burden of Smoking</h2>
<p>Smoking is not only detrimental to one's health but also puts a strain on your wallet. The cost of cigarettes has increased significantly over the years due to higher taxes and production costs. This financial burden can be overwhelming for many smokers, making it difficult to continue their habit.</p>
<h2>Vaping: A Cost-Effective Alternative</h2>
<p>Vaping offers an attractive alternative to smoking, not only in terms of health risks but also financially. Since vaping is subject to different regulations than traditional cigarettes, the cost of e-cigarettes and vape liquids is relatively lower. This presents a significant opportunity for savings for those looking to quit smoking.</p>
<h2>A Comprehensive Cost Comparison</h2>
<p>To help you make an informed decision about switching from smoking to vaping, we've put together this comprehensive cost comparison. We'll explore the costs associated with different types of vapes, including disposable devices, refillable pod kits, and tank vape kits.</p>
<h3>The Costs of Vaping</h3>
<ul>
<li><strong>Disposable vapes:</strong> These are the easiest option for newcomers, requiring no setup or maintenance. However, they can be more expensive in the long run due to the need to replace devices frequently.</li>
<li><strong>Refillable pod kits with removable coils:</strong> This type of vape offers customization options and is a cost-effective choice over time compared to disposable vapes and cigarettes.</li>
<li><strong>Tank vape kits:</strong> These require regular coil changes but offer the most savings over time since only the coil needs frequent replacement.</li>
</ul>
<h3>The Costs of Smoking</h3>
<ul>
<li>Loose tobacco (30g pouch): £20.00</li>
<li>Pack of 20 cigarettes: £15.00</li>
</ul>
<h2>The Verdict</h2>
<p>Switching from smoking to vaping can result in significant financial savings, depending on the vaping method selected. Although some initial costs for certain vape kits may seem high, the long-term savings are substantial compared to the ever-increasing price of cigarettes.</p>
<p>Moreover, vaping offers more customization options and potentially fewer health risks than traditional cigarettes. This makes it an attractive option for those looking to quit smoking altogether.</p>`,
  },
  nicPouches: {
    title: 'Nic Pouches in the UK',
    slug: 'nic-pouches-in-the-uk',
    metaDescription: 'The Rise of Nicotine Pouches in the UK — Unique Distribution news.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published article at uniquedistribution.com/blogs/news/the-rise-of-nicotine-pouches-in-the-uk-a-growing-trend-among-vapers. Not rewritten.</em></p>
<p>In recent years, nicotine pouches have emerged as a popular alternative to traditional e-liquids and vaping devices. These discreet, tobacco-free products contain nicotine salts suspended in a soothing oral strip that dissolves slowly under the tongue. As demand for nicotine pouches continues to surge across the UK, vape suppliers are taking notice of this trend.</p>
<h2>What's driving growth?</h2>
<p><strong>Convenience:</strong> Nicotine pouches offer a hassle-free experience, eliminating the need for e-liquids and vaping devices. <strong>Discreetness:</strong> The compact size and lack of vapor make them ideal for those who want to enjoy their nicotine fix without drawing attention. <strong>Tobacco-free:</strong> Many vapers are seeking alternatives that don't involve tobacco or combustion, making nicotine pouches an attractive option.</p>
<h2>Market growth</h2>
<p>According to a recent report by Grand View Research, the global nicotine pouch market is expected to reach USD 1.4 billion by 2025, growing at a CAGR of 12.6% during the forecast period. In the UK specifically, sales have seen a significant increase in recent years.</p>
<h2>Wholesale vape suppliers: Meeting demand</h2>
<p>As popularity of nicotine pouches continues to rise, wholesale vape suppliers are adapting to meet this new demand. Many are now offering nicotine pouch products as part of their product lines, catering to the growing number of vapers seeking alternative options.</p>
<h2>What's next?</h2>
<p>As market continues to evolve, we can expect increased competition, new product lines, and regulatory developments. As nicotine pouches become more mainstream, regulatory bodies may establish guidelines or standards for their production and sale.</p>
<p>The rise of nicotine pouches in the UK is a testament to growing demand for alternative vaping options. Wholesale vape suppliers are well-positioned to capitalize on this trend, offering range of products that cater to diverse consumer preferences.</p>`,
  },
  legalBigPuff: {
    title: "Legal Big Puff 'Devices",
    slug: 'legal-big-puff-devices',
    metaDescription: "The Growing Popularity of 'Legal Big Puff 'Devices — Unique Distribution news.",
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published article at uniquedistribution.com/blogs/news/the-growing-popularity-of-legal-big-puff-devices. Not rewritten.</em></p>
<h2>The Evolution of Vaping: Legal Big Puff Devices Revolutionize Convenience</h2>
<p>In recent years, vaping technology has undergone significant transformations. One such innovation that's taken the industry by storm is the rise of "Legal Big Puffs." These devices have redefined what it means to be convenient and portable.</p>
<p>To put it simply, Legal Big Puffs are rechargeable vape kits designed for those who crave a more sustainable vaping experience. Unlike traditional disposable vapes that often get discarded after a single use, these innovative devices offer up to 2,000 to 10,000 puffs on a single charge.</p>
<p>The key difference between Legal Big Puff devices and their disposable counterparts lies in the rechargeable feature. This game-changing technology allows users to refill and reuse their device multiple times, reducing waste and environmental impact.</p>
<ul>
<li><strong>Convenience:</strong> With up to 10,000 puffs on a single charge, users can enjoy their favorite flavors without worrying about running out mid-session.</li>
<li><strong>Sustainability:</strong> Rechargeable technology reduces waste and minimizes environmental impact.</li>
<li><strong>Cost-effective:</strong> Refilling the device instead of buying new ones saves money in the long run.</li>
</ul>
<p>In conclusion, Legal Big Puff devices represent a significant leap forward in vaping technology. By offering rechargeable options with impressive puff counts, these innovative devices have redefined what it means to be convenient and portable.</p>`,
  },
  disposableBan: {
    title: 'Disposable Ban 2025',
    slug: 'disposable-ban-2025',
    metaDescription: 'Disposable Vapes to be Banned in UK: What You Need to Know — Unique Distribution news.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published article at uniquedistribution.com/blogs/news/disposable-vapes-to-be-banned-in-uk-what-you-need-to-know. Not rewritten.</em></p>
<h2>Disposable Vapes to be Banned in UK: What You Need to Know</h2>
<p>As of October 28th, 2024, legislation has been laid before Parliament to prohibit the sale and stocking of disposable vapes in England as of June 1st, 2025. This move aims to reduce waste and promote a more sustainable economy.</p>
<p>The ban will also apply in Wales from June 1st, 2025. Northern Ireland is set to implement its own ban on April 1st, 2025, which has been pushed back to match the dates in England and Wales.</p>
<p>Using these guidelines we can see that classic disposable vapes are set to be banned, but also the likes of refillable, rechargeable disposables and certain big puff vapes. For a vape to escape the ban it will need to be refillable, rechargeable and have a replaceable coil. If a device fails to hit any of these three points it will be illegal after June 1st, 2025.</p>
<p>The first two points are very clear, your vape has to be refillable – either with bottled e-liquid, or with a prefilled pod – and the battery needs to be rechargeable with a charging port existing somewhere on the device. The third point explains that your device needs to be refillable AND rechargeable – it can’t be one or the other. Essentially, you need to be able to replace the coil in your vape.</p>
<h2>The Most Important Thing: Quit Smoking</h2>
<p>Regardless of which type of device you choose, the most important thing is not to start smoking again. Vapes are 95% less harmful than cigarettes and are advocated by Cancer Research UK, the British Heart Foundation, and the NHS as a safer alternative.</p>
<p>With plenty of time before the ban takes effect in June 2025, it's recommended that you explore your options for refillable or rechargeable devices.</p>`,
  },
  blogs: {
    title: 'Blogs',
    slug: 'blogs',
    metaDescription: 'Unique Distribution vape industry news and updates.',
    bodyHtml: `<p><em>Migrated from Unique Distribution’s published News list at uniquedistribution.com/blogs/news. Article bodies are copied onto Unique OS pages; this is not a second CMS.</em></p>
<ul>
<li><a href="/pages/vaping-vs-smoking">Vaping vs Smoking</a></li>
<li><a href="/pages/nic-pouches-in-the-uk">Nic Pouches in the UK</a></li>
<li><a href="/pages/legal-big-puff-devices">Legal Big Puff 'Devices</a></li>
<li><a href="/pages/disposable-ban-2025">Disposable Ban 2025</a></li>
</ul>`,
  },
} as const
