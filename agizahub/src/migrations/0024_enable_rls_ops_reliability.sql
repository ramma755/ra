DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOREACH t IN ARRAY ARRAY[
      'restock_alert_subscriptions',
      'outbound_message_queue'
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
