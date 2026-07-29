DO $$
DECLARE
  t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOREACH t IN ARRAY ARRAY[
      'platform_users',
      'catalog_items',
      'orders',
      'admin_action_events',
      'sender_abuse_controls',
      'webhook_request_logs',
      'admin_access_tokens',
      'admin_access_sessions'
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
