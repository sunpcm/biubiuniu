-- =============================================
-- Update handle_new_user function to grant welcome credits
-- =============================================

-- Update the handle_new_user function to grant 10 welcome credits
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Insert a new row into public.users
  insert into public.users (id, email, updated_at)
  values (new.id, new.email, now());
  
  -- Grant 10 welcome credits to the new user
  BEGIN
    -- Grant 10 one-time credits as welcome bonus
    PERFORM public.grant_one_time_credits_and_log(
      new.id,                    -- user_id
      10,                        -- credits to add
      null                       -- no related order
    );
    
    -- Update the credit log note to reflect this is a welcome bonus
    UPDATE public.credit_logs 
    SET notes = 'Welcome bonus: 10 free credits for new user registration'
    WHERE id = (
      SELECT id FROM public.credit_logs
      WHERE user_id = new.id 
        AND type = 'one_time_purchase' 
        AND amount = 10 
        AND created_at >= now() - INTERVAL '1 minute'
        AND notes = 'One-time credit purchase'
      ORDER BY created_at DESC 
      LIMIT 1
    );
    
  EXCEPTION
    WHEN OTHERS THEN
      -- If the credit granting fails, we don't want to block user registration
      RAISE WARNING 'Failed to grant welcome credits to user %: %', new.id, SQLERRM;
  END;
  
  return new;
end;
$$;
