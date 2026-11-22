-- Test that Steam ID columns are properly protected by trigger
-- Run this after applying migration 029 to verify security
-- DO NOT RUN IN PRODUCTION - this is for local/staging testing only

-- Setup: Create test user profiles
BEGIN;

-- Test users
INSERT INTO public.profiles (id, display_name) 
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'TestUser1'),
  ('00000000-0000-0000-0000-000000000002', 'TestUser2')
ON CONFLICT (id) DO NOTHING;

-- Test 1: authenticated role cannot INSERT with verified_steam_id
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  
  BEGIN
    INSERT INTO public.profiles (id, display_name, verified_steam_id)
    VALUES ('00000000-0000-0000-0000-000000000003', 'HackerUser', '76561198012345678');
    
    RAISE EXCEPTION 'TEST 1 FAILED: authenticated should not allow INSERT with verified_steam_id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be set by the server%' THEN
        RAISE NOTICE 'TEST 1 PASSED: authenticated INSERT with verified_steam_id blocked';
      ELSE
        RAISE EXCEPTION 'TEST 1 FAILED: Wrong error: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
  RESET request.jwt.claims;
END $$;

-- Test 2: authenticated role cannot UPDATE verified_steam_id
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  
  BEGIN
    UPDATE public.profiles 
    SET verified_steam_id = '76561198012345678'
    WHERE id = '00000000-0000-0000-0000-000000000001';
    
    RAISE EXCEPTION 'TEST 2 FAILED: authenticated should not allow UPDATE of verified_steam_id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be modified by the server%' THEN
        RAISE NOTICE 'TEST 2 PASSED: authenticated UPDATE of verified_steam_id blocked';
      ELSE
        RAISE EXCEPTION 'TEST 2 FAILED: Wrong error: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
  RESET request.jwt.claims;
END $$;

-- Test 3: anon role cannot UPDATE verified_steam_id
DO $$
BEGIN
  SET ROLE anon;
  SET request.jwt.claims TO '{"role":"anon"}';
  
  BEGIN
    UPDATE public.profiles 
    SET verified_steam_id = '76561198012345678'
    WHERE id = '00000000-0000-0000-0000-000000000001';
    
    RAISE EXCEPTION 'TEST 3 FAILED: anon should not allow UPDATE of verified_steam_id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be modified by the server%' THEN
        RAISE NOTICE 'TEST 3 PASSED: anon UPDATE of verified_steam_id blocked';
      ELSE
        RAISE EXCEPTION 'TEST 3 FAILED: Wrong error: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
  RESET request.jwt.claims;
END $$;

-- Test 4: service_role CAN set verified_steam_id
DO $$
BEGIN
  SET ROLE service_role;
  SET request.jwt.claims TO '{"role":"service_role"}';
  
  UPDATE public.profiles 
  SET verified_steam_id = '76561198012345678',
      steam_display_name = 'TestSteamUser',
      steam_verified_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';
  
  IF FOUND THEN
    RAISE NOTICE 'TEST 4 PASSED: service_role can set verified_steam_id';
  ELSE
    RAISE EXCEPTION 'TEST 4 FAILED: service_role UPDATE failed';
  END IF;
  
  RESET ROLE;
  RESET request.jwt.claims;
END $$;

-- Test 5: postgres (SQL editor, no JWT) CAN set verified_steam_id
DO $$
BEGIN
  SET ROLE postgres;
  RESET request.jwt.claims;
  
  UPDATE public.profiles 
  SET verified_steam_id = '76561198087654321',
      steam_display_name = 'MigrationUser',
      steam_verified_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000002';
  
  IF FOUND THEN
    RAISE NOTICE 'TEST 5 PASSED: postgres (no JWT) can set verified_steam_id';
  ELSE
    RAISE EXCEPTION 'TEST 5 FAILED: postgres UPDATE failed';
  END IF;
  
  RESET ROLE;
END $$;

-- Test 6: authenticated role cannot modify steam_display_name
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  
  BEGIN
    UPDATE public.profiles 
    SET steam_display_name = 'FakeName'
    WHERE id = '00000000-0000-0000-0000-000000000001';
    
    RAISE EXCEPTION 'TEST 6 FAILED: authenticated should not allow UPDATE of steam_display_name';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be modified by the server%' THEN
        RAISE NOTICE 'TEST 6 PASSED: authenticated UPDATE of steam_display_name blocked';
      ELSE
        RAISE EXCEPTION 'TEST 6 FAILED: Wrong error: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
  RESET request.jwt.claims;
END $$;

-- Test 7: authenticated role cannot modify steam_verified_at
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  
  BEGIN
    UPDATE public.profiles 
    SET steam_verified_at = now()
    WHERE id = '00000000-0000-0000-0000-000000000001';
    
    RAISE EXCEPTION 'TEST 7 FAILED: authenticated should not allow UPDATE of steam_verified_at';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be modified by the server%' THEN
        RAISE NOTICE 'TEST 7 PASSED: authenticated UPDATE of steam_verified_at blocked';
      ELSE
        RAISE EXCEPTION 'TEST 7 FAILED: Wrong error: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
  RESET request.jwt.claims;
END $$;

-- Test 8: authenticated role CAN update other profile columns
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  
  UPDATE public.profiles 
  SET display_name = 'UpdatedTestUser',
      discord_handle = 'newdiscord',
      steam_profile = 'https://steamcommunity.com/id/test'
  WHERE id = '00000000-0000-0000-0000-000000000001';
  
  IF FOUND THEN
    RAISE NOTICE 'TEST 8 PASSED: authenticated can update non-Steam columns';
  ELSE
    RAISE EXCEPTION 'TEST 8 FAILED: authenticated cannot update other columns';
  END IF;
  
  RESET ROLE;
  RESET request.jwt.claims;
END $$;

-- Test 9: Verify Steam columns were NOT modified by authenticated in Test 8
DO $$
DECLARE
  v_steam_id text;
  v_steam_name text;
BEGIN
  SELECT verified_steam_id, steam_display_name
  INTO v_steam_id, v_steam_name
  FROM public.profiles
  WHERE id = '00000000-0000-0000-0000-000000000001';
  
  IF v_steam_id = '76561198012345678' AND v_steam_name = 'TestSteamUser' THEN
    RAISE NOTICE 'TEST 9 PASSED: Steam columns unchanged after authenticated UPDATE';
  ELSE
    RAISE EXCEPTION 'TEST 9 FAILED: Steam columns were modified (id: %, name: %)', v_steam_id, v_steam_name;
  END IF;
END $$;

-- Cleanup
DELETE FROM public.profiles WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003'
);

ROLLBACK;

-- Summary
DO $$
BEGIN
  RAISE NOTICE '====================================';
  RAISE NOTICE '=== All Tests Completed ===';
  RAISE NOTICE 'If you see 9 "TEST PASSED" messages above,';
  RAISE NOTICE 'the trigger is working correctly.';
  RAISE NOTICE '====================================';
END $$;
