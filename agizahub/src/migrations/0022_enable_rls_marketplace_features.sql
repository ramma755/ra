DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOREACH t IN ARRAY ARRAY[
      'order_line_items',
      'cart_items',
      'wishlist_items',
      'seller_ratings',
      'loyalty_wallets',
      'loyalty_points_ledger',
      'referral_codes',
      'referrals',
      'seller_payout_requests',
      'promo_broadcasts'
    ]
    LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS service_role_all ON public.%I;', t);
      EXECUTE format(
        'CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        t
      );
    END LOOP;
  END IF;
END $$;
