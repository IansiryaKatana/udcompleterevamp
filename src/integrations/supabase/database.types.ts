export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: {
          id: string
          name: string
          slug: string
          parent_id: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['categories']['Row']> & {
          name: string
          slug: string
        }
        Update: Partial<Database['public']['Tables']['categories']['Row']>
      }
      collections: {
        Row: {
          id: string
          title: string
          slug: string
          description: string | null
          cover_image_url: string | null
          type: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['collections']['Row']> & {
          title: string
          slug: string
        }
        Update: Partial<Database['public']['Tables']['collections']['Row']>
      }
      coupons: {
        Row: {
          id: string
          code: string
          description: string | null
          discount_type: string
          discount_value: number
          min_subtotal: number
          max_uses: number | null
          used_count: number
          starts_at: string | null
          expires_at: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['coupons']['Row']> & {
          code: string
          discount_type: string
          discount_value: number
        }
        Update: Partial<Database['public']['Tables']['coupons']['Row']>
      }
      shipping_zones: {
        Row: {
          id: string
          name: string
          countries: Json
          flat_rate: number
          free_shipping_threshold: number | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['shipping_zones']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['shipping_zones']['Row']>
      }
      storefront_carts: {
        Row: {
          id: string
          user_id: string | null
          session_id: string | null
          email: string | null
          items: Json
          coupon_code: string | null
          last_activity_at: string
          abandoned_email_sent_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['storefront_carts']['Row']>
        Update: Partial<Database['public']['Tables']['storefront_carts']['Row']>
      }
      stock_alert_subscriptions: {
        Row: {
          id: string
          email: string
          product_id: string
          variant_id: string | null
          notified_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['stock_alert_subscriptions']['Row']> & {
          email: string
          product_id: string
        }
        Update: Partial<Database['public']['Tables']['stock_alert_subscriptions']['Row']>
      }
      products: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          price: number
          compare_at_price: number | null
          sku: string | null
          weight_kg: number | null
          specs: unknown
          image_url: string | null
          gallery_urls: unknown
          category_id: string | null
          collection_id: string | null
          badge: string | null
          is_featured: boolean
          is_new: boolean
          is_summer: boolean
          inventory_count: number
          published: boolean
          overview: string | null
          delivery_info: string | null
          use_default_delivery: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['products']['Row']> & {
          name: string
          slug: string
          price: number
        }
        Update: Partial<Database['public']['Tables']['products']['Row']>
      }
      product_bundles: {
        Row: {
          id: string
          name: string
          slug: string
          overview: string | null
          description: string | null
          price: number
          compare_at_price: number | null
          sku: string | null
          image_url: string | null
          gallery_urls: Json
          badge: string | null
          published: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['product_bundles']['Row']> & {
          name: string
          slug: string
          price: number
        }
        Update: Partial<Database['public']['Tables']['product_bundles']['Row']>
      }
      product_bundle_items: {
        Row: {
          id: string
          bundle_id: string
          product_id: string
          variant_id: string | null
          quantity: number
          sort_order: number
          label: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['product_bundle_items']['Row']> & {
          bundle_id: string
          product_id: string
        }
        Update: Partial<Database['public']['Tables']['product_bundle_items']['Row']>
      }
      product_variants: {
        Row: {
          id: string
          product_id: string
          name: string
          sku: string | null
          price: number | null
          compare_at_price: number | null
          inventory_count: number
          option_values: Json
          image_url: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['product_variants']['Row']> & {
          product_id: string
          name: string
        }
        Update: Partial<Database['public']['Tables']['product_variants']['Row']>
      }
      product_reviews: {
        Row: {
          id: string
          product_id: string
          user_id: string
          order_id: string | null
          rating: number
          title: string | null
          body: string
          status: string
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['product_reviews']['Row']> & {
          product_id: string
          user_id: string
          rating: number
          body: string
        }
        Update: Partial<Database['public']['Tables']['product_reviews']['Row']>
      }
      wishlists: {
        Row: {
          id: string
          user_id: string
          product_id: string
          created_at: string
        }
        Insert: { user_id: string; product_id: string }
        Update: Partial<Database['public']['Tables']['wishlists']['Row']>
      }
      hero_slides: {
        Row: {
          id: string
          headline_lines: Json
          cta_label: string | null
          cta_url: string | null
          image_url: string | null
          image_url_tablet: string | null
          image_url_mobile: string | null
          background_color: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['hero_slides']['Row']>
        Update: Partial<Database['public']['Tables']['hero_slides']['Row']>
      }
      feature_cards: {
        Row: {
          id: string
          title: string
          cta_label: string | null
          cta_url: string | null
          image_url: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['feature_cards']['Row']> & { title: string }
        Update: Partial<Database['public']['Tables']['feature_cards']['Row']>
      }
      lifestyle_cards: {
        Row: {
          id: string
          title: string
          cta_label: string | null
          cta_url: string | null
          image_url: string | null
          layout: string
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['lifestyle_cards']['Row']> & { title: string }
        Update: Partial<Database['public']['Tables']['lifestyle_cards']['Row']>
      }
      homepage_sections: {
        Row: {
          id: string
          section_key: string
          title: string | null
          subtitle: string | null
          image_url: string | null
          cta_label: string | null
          cta_url: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['homepage_sections']['Row']> & { section_key: string }
        Update: Partial<Database['public']['Tables']['homepage_sections']['Row']>
      }
      nav_links: {
        Row: {
          id: string
          label: string
          href: string
          location: string
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['nav_links']['Row']> & { label: string; href: string; location: string }
        Update: Partial<Database['public']['Tables']['nav_links']['Row']>
      }
      social_links: {
        Row: {
          id: string
          label: string
          href: string
          icon: string
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['social_links']['Row']> & { label: string; href: string }
        Update: Partial<Database['public']['Tables']['social_links']['Row']>
      }
      site_settings: {
        Row: { key: string; value: string; updated_at: string }
        Insert: { key: string; value?: string }
        Update: Partial<Database['public']['Tables']['site_settings']['Row']>
      }
      newsletter_subscribers: {
        Row: { id: string; email: string; source: string | null; created_at: string }
        Insert: { email: string; source?: string }
        Update: Partial<Database['public']['Tables']['newsletter_subscribers']['Row']>
      }
      cms_media: {
        Row: {
          id: string
          public_url: string
          folder: string | null
          kind: string | null
          file_name: string | null
          created_at: string
        }
        Insert: { public_url: string; folder?: string; kind?: string; file_name?: string }
        Update: Partial<Database['public']['Tables']['cms_media']['Row']>
      }
      admin_users: {
        Row: {
          id: string
          auth_user_id: string | null
          email: string
          role: string
          is_active: boolean
          staff_member_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: { email: string; role?: string; staff_member_id?: string | null }
        Update: Partial<Database['public']['Tables']['admin_users']['Row']>
      }
      form_submissions: {
        Row: {
          id: string
          form_type: string
          payload: Json
          status: string
          created_at: string
          admin_viewed_at: string | null
        }
        Insert: { form_type?: string; payload?: Json; status?: string }
        Update: Partial<Database['public']['Tables']['form_submissions']['Row']>
      }
      marketing_pages: {
        Row: {
          id: string
          title: string
          slug: string
          body_html: string | null
          meta_description: string | null
          published: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['marketing_pages']['Row']> & { title: string; slug: string }
        Update: Partial<Database['public']['Tables']['marketing_pages']['Row']>
      }
      orders: {
        Row: {
          id: string
          order_number: string
          email: string
          status: string
          fulfillment_status: string
          tracking_number: string | null
          carrier: string | null
          shipped_at: string | null
          currency: string
          subtotal: number
          shipping_total: number
          tax_total: number
          discount_total: number
          coupon_code: string | null
          total: number
          stripe_session_id: string | null
          stripe_payment_intent_id: string | null
          shipping_address: Json | null
          metadata: Json | null
          user_id: string | null
          admin_viewed_at: string | null
          customer_id: string | null
          company_id: string | null
          company_location_id: string | null
          financial_status: string | null
          commerce_fulfillment_status: string | null
          delivery_status: string | null
          order_source: string | null
          source_app: string | null
          purchase_order_number: string | null
          trading_name_snapshot: string | null
          salesperson_id: string | null
          referrer_id: string | null
          cg_assigned_id: string | null
          total_received: number
          total_outstanding: number
          taxes_included: boolean
          source_created_at: string | null
          source_updated_at: string | null
          processed_at: string | null
          closed_at: string | null
          cancelled_at: string | null
          cancel_reason: string | null
          shopify_order_gid: string | null
          shopify_legacy_id: string | null
          source_order_number: string | null
          imported_at: string | null
          note: string | null
          payment_due_on: string | null
          payment_gateway_names: string[]
          ar_account_id: string | null
          primary_fulfillment_id: string | null
          dpd_delivery_status: string | null
          draft_order_id: string | null
          customer_type_snapshot: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['orders']['Row']> & { order_number: string; email: string }
        Update: Partial<Database['public']['Tables']['orders']['Row']>
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          product_slug: string | null
          image_url: string | null
          unit_price: number
          quantity: number
          line_total: number
          variant_id: string | null
          variant_name: string | null
          bundle_id: string | null
          metadata: Json
          sku_snapshot: string | null
          variant_title_snapshot: string | null
          vendor_snapshot: string | null
          product_type_snapshot: string | null
          barcode_snapshot: string | null
          original_unit_price: number | null
          discount_total: number
          tax_total: number
          taxable: boolean
          tax_rate_snapshot: number | null
          product_shopify_gid: string | null
          variant_shopify_gid: string | null
          source_line_item_gid: string | null
          deleted_product: boolean
          properties: Json
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['order_items']['Row']> & { order_id: string; product_name: string; unit_price: number; line_total: number }
        Update: Partial<Database['public']['Tables']['order_items']['Row']>
      }
      email_templates: {
        Row: {
          id: string
          template_key: string
          name: string
          description: string
          subject: string
          body_html: string
          enabled: boolean
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['email_templates']['Row']> & {
          template_key: string
          name: string
          subject: string
          body_html: string
        }
        Update: Partial<Database['public']['Tables']['email_templates']['Row']>
      }
      private_settings: {
        Row: { key: string; value: string; updated_at: string }
        Insert: { key: string; value: string }
        Update: Partial<Database['public']['Tables']['private_settings']['Row']>
      }
      external_system_refs: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          system: string
          external_gid: string | null
          external_legacy_id: string | null
          external_key: string | null
          external_number: string | null
          metadata: Json
          first_seen_at: string | null
          last_seen_at: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['external_system_refs']['Row']> & {
          entity_type: string
          entity_id: string
          system: string
        }
        Update: Partial<Database['public']['Tables']['external_system_refs']['Row']>
      }
      staff_members: {
        Row: {
          id: string
          auth_user_id: string | null
          name: string
          email: string | null
          active: boolean
          staff_type: string
          role_metadata: Json
          notes: string | null
          source_system: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['staff_members']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['staff_members']['Row']>
      }
      customers: {
        Row: {
          id: string
          auth_user_id: string | null
          email: string | null
          phone: string | null
          first_name: string | null
          last_name: string | null
          display_name: string | null
          company_name_snapshot: string | null
          trading_name: string | null
          notes: string | null
          tax_exempt: boolean
          tax_exemption_details: Json
          status: string
          approval_status: string
          registration_channel: string | null
          customer_type: string | null
          salesperson_id: string | null
          referrer_id: string | null
          cg_assigned_id: string | null
          legacy_customer_id: string | null
          source_system: string | null
          shopify_created_at: string | null
          shopify_updated_at: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['customers']['Row']>
        Update: Partial<Database['public']['Tables']['customers']['Row']>
      }
      customer_addresses: {
        Row: {
          id: string
          customer_id: string
          address_type: string
          is_default: boolean
          first_name: string | null
          last_name: string | null
          company: string | null
          address1: string | null
          address2: string | null
          city: string | null
          province: string | null
          province_code: string | null
          postal_code: string | null
          country: string | null
          country_code: string | null
          phone: string | null
          company_location_id: string | null
          source_system: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['customer_addresses']['Row']> & { customer_id: string }
        Update: Partial<Database['public']['Tables']['customer_addresses']['Row']>
      }
      companies: {
        Row: {
          id: string
          name: string
          trading_name: string | null
          legal_name: string | null
          company_number: string | null
          vat_number: string | null
          status: string
          customer_type: string | null
          salesperson_id: string | null
          referrer_id: string | null
          cg_assigned_id: string | null
          notes: string | null
          source_system: string | null
          shopify_created_at: string | null
          shopify_updated_at: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['companies']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['companies']['Row']>
      }
      company_locations: {
        Row: {
          id: string
          company_id: string
          name: string | null
          phone: string | null
          email: string | null
          tax_exempt: boolean
          tax_exemptions: Json
          payment_terms_template: Json | null
          billing_address: Json
          shipping_address: Json
          address1: string | null
          address2: string | null
          city: string | null
          province: string | null
          province_code: string | null
          postal_code: string | null
          country: string | null
          country_code: string | null
          is_primary: boolean
          source_system: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['company_locations']['Row']> & { company_id: string }
        Update: Partial<Database['public']['Tables']['company_locations']['Row']>
      }
      company_contacts: {
        Row: {
          id: string
          company_id: string
          customer_id: string
          company_location_id: string | null
          title: string | null
          role: string | null
          is_primary: boolean
          receives_orders: boolean
          receives_invoices: boolean
          source_system: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['company_contacts']['Row']> & {
          company_id: string
          customer_id: string
        }
        Update: Partial<Database['public']['Tables']['company_contacts']['Row']>
      }
      entity_assignments: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          assignment_type: string
          staff_member_id: string
          source: string | null
          valid_from: string
          valid_to: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['entity_assignments']['Row']> & {
          entity_type: string
          entity_id: string
          assignment_type: string
          staff_member_id: string
        }
        Update: Partial<Database['public']['Tables']['entity_assignments']['Row']>
      }
      tags: {
        Row: {
          id: string
          name: string
          normalized_name: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['tags']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['tags']['Row']>
      }
      entity_tags: {
        Row: {
          id: string
          tag_id: string
          entity_type: string
          entity_id: string
          raw_value: string
          source_system: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['entity_tags']['Row']> & {
          tag_id: string
          entity_type: string
          entity_id: string
          raw_value: string
        }
        Update: Partial<Database['public']['Tables']['entity_tags']['Row']>
      }
      metafields: {
        Row: {
          id: string
          owner_type: string
          owner_id: string
          namespace: string
          key: string
          value_type: string | null
          value_text: string | null
          value_json: Json | null
          definition_name: string | null
          definition_description: string | null
          source_system: string
          external_gid: string | null
          source_created_at: string | null
          source_updated_at: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['metafields']['Row']> & {
          owner_type: string
          owner_id: string
          namespace: string
          key: string
        }
        Update: Partial<Database['public']['Tables']['metafields']['Row']>
      }
      order_events: {
        Row: {
          id: string
          order_id: string
          event_type: string
          category: string
          source_system: string | null
          source_app: string | null
          actor_type: string | null
          actor_id: string | null
          actor_name_snapshot: string | null
          message: string | null
          old_value: Json | null
          new_value: Json | null
          metadata: Json
          external_event_id: string | null
          occurred_at: string
          imported_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['order_events']['Row']> & {
          order_id: string
          event_type: string
        }
        Update: Partial<Database['public']['Tables']['order_events']['Row']>
      }
      order_comments: {
        Row: {
          id: string
          order_id: string
          author_staff_id: string | null
          author_name_snapshot: string | null
          body: string
          source_system: string | null
          source_app: string | null
          external_event_id: string | null
          occurred_at: string
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['order_comments']['Row']> & {
          order_id: string
          body: string
        }
        Update: Partial<Database['public']['Tables']['order_comments']['Row']>
      }
      payment_transactions: {
        Row: {
          id: string
          order_id: string
          parent_transaction_id: string | null
          kind: string
          status: string
          gateway: string | null
          formatted_gateway: string | null
          amount: number
          currency: string
          payment_id: string | null
          authorization_code: string | null
          error_code: string | null
          account_number_masked: string | null
          test: boolean
          manually_capturable: boolean
          processed_at: string | null
          source_created_at: string | null
          source_system: string | null
          external_gid: string | null
          external_legacy_id: string | null
          metadata: Json
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['payment_transactions']['Row']> & {
          order_id: string
          kind: string
          status: string
          amount: number
        }
        Update: Partial<Database['public']['Tables']['payment_transactions']['Row']>
      }
      ar_accounts: {
        Row: {
          id: string
          company_id: string | null
          customer_id: string | null
          status: string
          currency: string
          credit_limit: number | null
          current_balance: number
          overdue_balance: number
          payment_terms_label: string | null
          payment_terms_due_in_days: number | null
          cg_assigned_id: string | null
          notes: string | null
          source_system: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['ar_accounts']['Row']>
        Update: Partial<Database['public']['Tables']['ar_accounts']['Row']>
      }
      ar_entries: {
        Row: {
          id: string
          ar_account_id: string
          order_id: string | null
          payment_transaction_id: string | null
          entry_type: string
          amount: number
          currency: string
          direction: string
          due_on: string | null
          occurred_at: string
          memo: string | null
          source_system: string | null
          external_gid: string | null
          metadata: Json
          imported_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['ar_entries']['Row']> & {
          ar_account_id: string
          entry_type: string
          amount: number
        }
        Update: Partial<Database['public']['Tables']['ar_entries']['Row']>
      }
      order_tax_lines: {
        Row: {
          id: string
          order_id: string
          order_item_id: string | null
          title: string
          rate: number | null
          rate_percentage: number | null
          price: number
          currency: string
          channel_liable: boolean | null
          source_system: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['order_tax_lines']['Row']> & {
          order_id: string
          title: string
        }
        Update: Partial<Database['public']['Tables']['order_tax_lines']['Row']>
      }
      refunds: {
        Row: {
          id: string
          order_id: string
          note: string | null
          total_refunded: number
          currency: string
          source_created_at: string | null
          source_system: string | null
          external_gid: string | null
          metadata: Json
          imported_at: string | null
          payment_transaction_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['refunds']['Row']> & { order_id: string }
        Update: Partial<Database['public']['Tables']['refunds']['Row']>
      }
      refund_line_items: {
        Row: {
          id: string
          refund_id: string
          order_item_id: string | null
          quantity: number
          restock_type: string | null
          subtotal: number
          total_tax: number
          sku_snapshot: string | null
          name_snapshot: string | null
          source_system: string | null
          external_gid: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['refund_line_items']['Row']> & { refund_id: string }
        Update: Partial<Database['public']['Tables']['refund_line_items']['Row']>
      }
      credit_notes: {
        Row: {
          id: string
          order_id: string | null
          customer_id: string | null
          company_id: string | null
          ar_account_id: string | null
          refund_id: string | null
          status: string
          flag_value: string | null
          amount: number | null
          currency: string
          reason: string | null
          document_number: string | null
          issued_at: string | null
          source_system: string | null
          external_gid: string | null
          metadata: Json
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['credit_notes']['Row']>
        Update: Partial<Database['public']['Tables']['credit_notes']['Row']>
      }
      inventory_locations: {
        Row: {
          id: string
          name: string
          code: string | null
          is_active: boolean
          is_primary: boolean
          fulfills_online_orders: boolean
          address1: string | null
          address2: string | null
          city: string | null
          province: string | null
          province_code: string | null
          postal_code: string | null
          country: string | null
          country_code: string | null
          phone: string | null
          source_system: string | null
          external_gid: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['inventory_locations']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['inventory_locations']['Row']>
      }
      order_shipping_lines: {
        Row: {
          id: string
          order_id: string
          title: string | null
          code: string | null
          source: string | null
          carrier_identifier: string | null
          original_price: number
          currency: string
          source_system: string | null
          external_gid: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['order_shipping_lines']['Row']> & { order_id: string }
        Update: Partial<Database['public']['Tables']['order_shipping_lines']['Row']>
      }
      fulfillments: {
        Row: {
          id: string
          order_id: string
          inventory_location_id: string | null
          status: string | null
          display_status: string | null
          name: string | null
          service_handle: string | null
          service_name: string | null
          tracking_company: string | null
          tracking_number: string | null
          tracking_url: string | null
          tracking_info: Json
          carrier_status: string | null
          carrier_status_raw: Json
          estimated_delivery_at: string | null
          in_transit_at: string | null
          delivered_at: string | null
          source_created_at: string | null
          source_updated_at: string | null
          source_system: string | null
          external_gid: string | null
          metadata: Json
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['fulfillments']['Row']> & { order_id: string }
        Update: Partial<Database['public']['Tables']['fulfillments']['Row']>
      }
      fulfillment_line_items: {
        Row: {
          id: string
          fulfillment_id: string
          order_item_id: string | null
          quantity: number
          sku_snapshot: string | null
          name_snapshot: string | null
          source_system: string | null
          external_gid: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['fulfillment_line_items']['Row']> & {
          fulfillment_id: string
        }
        Update: Partial<Database['public']['Tables']['fulfillment_line_items']['Row']>
      }
      shipment_events: {
        Row: {
          id: string
          fulfillment_id: string | null
          order_id: string
          event_type: string
          status: string | null
          message: string | null
          source_system: string | null
          source_app: string | null
          tracking_number: string | null
          tracking_company: string | null
          location_label: string | null
          occurred_at: string
          metadata: Json
          external_event_id: string | null
          imported_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['shipment_events']['Row']> & {
          order_id: string
          event_type: string
        }
        Update: Partial<Database['public']['Tables']['shipment_events']['Row']>
      }
      draft_orders: {
        Row: {
          id: string
          name: string | null
          status: string
          email: string | null
          phone: string | null
          note: string | null
          po_number: string | null
          tax_exempt: boolean
          taxes_included: boolean
          currency: string
          ready: boolean
          reserve_inventory_until: string | null
          subtotal: number
          total_tax: number
          total_shipping: number
          total_discounts: number
          total_price: number
          invoice_url: string | null
          invoice_sent_at: string | null
          completed_at: string | null
          purchasing_entity_type: string | null
          customer_id: string | null
          company_id: string | null
          company_location_id: string | null
          salesperson_id: string | null
          referrer_id: string | null
          trading_name_snapshot: string | null
          customer_type_snapshot: string | null
          payment_due_on: string | null
          billing_address: Json
          shipping_address: Json
          custom_attributes: Json
          shipping_line: Json | null
          converted_order_id: string | null
          source_system: string | null
          shopify_draft_gid: string | null
          shopify_legacy_id: string | null
          source_created_at: string | null
          source_updated_at: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['draft_orders']['Row']>
        Update: Partial<Database['public']['Tables']['draft_orders']['Row']>
      }
      draft_order_line_items: {
        Row: {
          id: string
          draft_order_id: string
          product_id: string | null
          variant_id: string | null
          title: string
          variant_title: string | null
          sku_snapshot: string | null
          vendor_snapshot: string | null
          quantity: number
          original_unit_price: number
          discounted_unit_price: number | null
          original_total: number
          discounted_total: number | null
          taxable: boolean
          requires_shipping: boolean
          custom_attributes: Json
          tax_lines: Json
          product_shopify_gid: string | null
          variant_shopify_gid: string | null
          source_line_item_gid: string | null
          deleted_product: boolean
          sort_order: number
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['draft_order_line_items']['Row']> & {
          draft_order_id: string
          title: string
        }
        Update: Partial<Database['public']['Tables']['draft_order_line_items']['Row']>
      }
      abandoned_checkouts: {
        Row: {
          id: string
          customer_id: string | null
          email: string | null
          completed_at: string | null
          abandoned_checkout_url: string | null
          subtotal: number
          total_tax: number
          total_discount: number
          total_price: number
          currency: string
          billing_address: Json
          shipping_address: Json
          line_items: Json
          source_system: string | null
          shopify_checkout_gid: string | null
          source_created_at: string | null
          source_updated_at: string | null
          imported_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['abandoned_checkouts']['Row']>
        Update: Partial<Database['public']['Tables']['abandoned_checkouts']['Row']>
      }
    }
    Functions: {
      rpc_subscribe_newsletter: {
        Args: { p_email: string; p_source?: string }
        Returns: Json
      }
      rpc_submit_contact_form: {
        Args: { p_name: string; p_email: string; p_message: string }
        Returns: Json
      }
      rpc_get_homepage_products: {
        Args: { p_section?: string }
        Returns: Database['public']['Tables']['products']['Row'][]
      }
      rpc_get_collection_products: {
        Args: { p_collection_slug: string }
        Returns: Database['public']['Tables']['products']['Row'][]
      }
      rpc_get_cart_totals: {
        Args: { p_items: Json; p_currency?: string; p_shipping_country?: string | null; p_coupon_code?: string | null }
        Returns: Json
      }
      rpc_get_admin_session: {
        Args: Record<string, never>
        Returns: Json
      }
      rpc_get_admin_edit_context: {
        Args: Record<string, never>
        Returns: Json
      }
      rpc_list_cms_media: {
        Args: { p_limit?: number; p_offset?: number; p_kind?: string | null; p_search?: string | null }
        Returns: Json
      }
      rpc_register_cms_media: {
        Args: { p_public_url: string; p_folder?: string; p_kind?: string; p_file_name?: string | null }
        Returns: Json
      }
      rpc_get_admin_dashboard: {
        Args: Record<string, never>
        Returns: Json
      }
      rpc_list_admin_products: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string | null }
        Returns: Json
      }
      rpc_list_admin_orders: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string | null }
        Returns: Json
      }
      rpc_list_admin_orders_v2: {
        Args: { p_limit?: number; p_offset?: number; p_sort?: string; p_filters?: Json }
        Returns: Json
      }
      rpc_admin_order_filter_facets: {
        Args: Record<string, never>
        Returns: Json
      }
      rpc_get_admin_order_workspace: {
        Args: { p_order_id: string }
        Returns: Json
      }
      rpc_list_admin_order_items: {
        Args: { p_order_id: string; p_limit?: number; p_offset?: number; p_search?: string | null }
        Returns: Json
      }
      rpc_list_admin_order_payments: {
        Args: { p_order_id: string }
        Returns: Json
      }
      rpc_list_admin_order_fulfillments: {
        Args: { p_order_id: string }
        Returns: Json
      }
      rpc_list_admin_order_timeline: {
        Args: { p_order_id: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      rpc_admin_add_order_comment: {
        Args: { p_order_id: string; p_body: string }
        Returns: Json
      }
      rpc_admin_update_order_ops: {
        Args: { p_order_id: string; p_patch: Json }
        Returns: Json
      }
      rpc_admin_fulfill_order_inventory: {
        Args: { p_order_id: string }
        Returns: Json
      }
      rpc_check_rate_limit: {
        Args: { p_action: string; p_identifier: string; p_max_requests?: number; p_window_seconds?: number }
        Returns: Json
      }
      rpc_list_storefront_products: {
        Args: {
          p_filter?: string
          p_slug?: string | null
          p_limit?: number
          p_offset?: number
          p_min_price?: number | null
          p_max_price?: number | null
          p_in_stock_only?: boolean
          p_sort?: string
        }
        Returns: Json
      }
      rpc_search_storefront_products: {
        Args: { p_query: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      rpc_get_storefront_product: {
        Args: { p_slug: string }
        Returns: Json
      }
      rpc_submit_product_review: {
        Args: { p_product_id: string; p_rating: number; p_title?: string; p_body?: string }
        Returns: Json
      }
      rpc_can_review_product: {
        Args: { p_product_id: string }
        Returns: Json
      }
      rpc_toggle_wishlist: {
        Args: { p_product_id: string }
        Returns: Json
      }
      rpc_list_wishlist_product_ids: {
        Args: Record<string, never>
        Returns: Json
      }
      rpc_list_storefront_bundles: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      rpc_get_storefront_bundle: {
        Args: { p_slug: string }
        Returns: Json
      }
      bundle_available_quantity: {
        Args: { p_bundle_id: string; p_selections?: Json }
        Returns: number
      }
      rpc_sync_storefront_cart: {
        Args: { p_session_id: string; p_items: Json; p_email?: string | null; p_coupon_code?: string | null }
        Returns: Json
      }
      rpc_subscribe_stock_alert: {
        Args: { p_email: string; p_product_id: string; p_variant_id?: string | null }
        Returns: Json
      }
      rpc_list_admin_customers: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string | null }
        Returns: Json
      }
      rpc_list_low_stock_products: {
        Args: { p_threshold?: number | null }
        Returns: Json
      }
      rpc_product_autocomplete: {
        Args: { p_query: string; p_limit?: number }
        Returns: Json
      }
    }
  }
}
