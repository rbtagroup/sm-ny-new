revoke all on function public.rb_ensure_driver_signup_profile(text, text) from public;
revoke all on function public.rb_ensure_driver_signup_profile(text, text) from anon;
revoke all on function public.rb_ensure_driver_signup_profile(text, text) from service_role;
grant execute on function public.rb_ensure_driver_signup_profile(text, text) to authenticated;
