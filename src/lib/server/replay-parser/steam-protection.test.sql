-- Test that non-service_role cannot modify verified_steam_id columns
-- Run this after applying migration 029 to verify the trigger works
-- DO NOT RUN IN PRODUCTION - this is for local testing only

-- Setup: Create a test user profile
BEGIN;

-- Assume we have a test user with id '00000000-0000-0000-0000-000000000001'
INSERT INTO public.profiles (id, display_name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'TestUser')
ON CONFLICT (id) DO NOTHING;

-- Test 1: Non-service role cannot INSERT with verified_steam_id set
-- Expected: Should raise exception
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001"}';
  
  BEGIN
    INSERT INTO public.profiles (id, display_name, verified_steam_id)
    VALUES ('00000000-0000-0000-0000-000000000002', 'HackerUser', '76561198012345678');
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow INSERT with verified_steam_id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be set by the server%' THEN
        RAISE NOTICE 'TEST PASSED: INSERT with verified_steam_id blocked';
      ELSE
        RAISE EXCEPTION 'TEST FAILED: Wrong error message: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
END $$;

-- Test 2: Non-service role cannot UPDATE verified_steam_id
-- Expected: Should raise exception
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001"}';
  
  BEGIN
    UPDATE public.profiles 
    SET verified_steam_id = '76561198012345678'
    WHERE id = '00000000-0000-0000-0000-000000000001';
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow UPDATE of verified_steam_id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be modified by the server%' THEN
        RAISE NOTICE 'TEST PASSED: UPDATE of verified_steam_id blocked';
      ELSE
        RAISE EXCEPTION 'TEST FAILED: Wrong error message: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
END $$;

-- Test 3: Service role CAN set verified_steam_id
-- Expected: Should succeed
DO $$
BEGIN
  SET ROLE service_role;
  
  UPDATE public.profiles 
  SET verified_steam_id = '76561198012345678',
      steam_display_name = 'TestSteamUser',
      steam_verified_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';
  
  IF FOUND THEN
    RAISE NOTICE 'TEST PASSED: service_role can set verified_steam_id';
  ELSE
    RAISE EXCEPTION 'TEST FAILED: service_role UPDATE failed';
  END IF;
  
  RESET ROLE;
END $$;

-- Test 4: Non-service role cannot modify steam_display_name or steam_verified_at
-- Expected: Should raise exception
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001"}';
  
  BEGIN
    UPDATE public.profiles 
    SET steam_display_name = 'FakeName'
    WHERE id = '00000000-0000-0000-0000-000000000001';
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow UPDATE of steam_display_name';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%can only be modified by the server%' THEN
        RAISE NOTICE 'TEST PASSED: UPDATE of steam_display_name blocked';
      ELSE
        RAISE EXCEPTION 'TEST FAILED: Wrong error message: %', SQLERRM;
      END IF;
  END;
  
  RESET ROLE;
END $$;

-- Test 5: Non-service role CAN update other columns
-- Expected: Should succeed
DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000001"}';
  
  UPDATE public.profiles 
  SET display_name = 'UpdatedTestUser'
  WHERE id = '00000000-0000-0000-0000-000000000001';
  
  IF FOUND THEN
    RAISE NOTICE 'TEST PASSED: authenticated role can update other columns';
  ELSE
    RAISE EXCEPTION 'TEST FAILED: authenticated role cannot update display_name';
  END IF;
  
  RESET ROLE;
END $$;

-- Cleanup
DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000001';

ROLLBACK;

-- Summary
RAISE NOTICE '=== All Tests Completed ===';
RAISE NOTICE 'If you see 5 "TEST PASSED" messages above, the trigger is working correctly.';
