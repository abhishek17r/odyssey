// Cloud sync settings: your Supabase project's URL and its public (publishable / anon) key.
// Sign-in is a username + password (Supabase Auth); only the owner account can read or write.
// appUrl: where the phone app lives once it's online.
// Leave url / anonKey empty to stay local-only.
export const CLOUD = {
  url: 'https://wotlxnvhhgtrgsaggvui.supabase.co',
  anonKey: 'sb_publishable_wxXn4WOI4rkir2Mif8p6XA_kHdLORGu',
  appUrl: 'https://odyssey.abhishek17r.workers.dev',
  // Siri: an iCloud link to the shared Odyssey Shortcut (made once by the owner, with an import question for the
  // Siri key). Empty: the app shows the steps to build it instead.
  siriShortcut: '',
  pushKey: 'BK6mUYOeLoPHKwSqtOYBvt36k5SC-D8NHvj-L7laPRHgefnAvIAGtVk-L6fSASONJIMF3F394EX2wM2PIhvFC58', // public half of the push key pair (the private half is a Supabase secret)
};
