# Email templates

Paste into **Supabase → Authentication → Emails → Templates**: pick the template, set the subject, paste the
file's contents into the message body (source / HTML), **Save**. `{{ .ConfirmationURL }}` and `{{ .Email }}`
are filled in by Supabase when it sends; the dashboard preview may show them as they are.

| Supabase template | File | Subject |
|---|---|---|
| Invite user | `invite.html` | You’re invited to Odyssey ⛵ |
| Reset password | `reset-password.html` | Reset your Odyssey password |

No images (some mail apps and previews block them): the header icon is a ⛵ character.
