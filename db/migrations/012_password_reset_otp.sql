alter table email_verification_otps
  drop constraint if exists email_verification_otps_purpose_check;

alter table email_verification_otps
  add constraint email_verification_otps_purpose_check
  check (purpose in ('signup', 'password_reset'));
