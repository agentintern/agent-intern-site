-- Set only when someone turns on notifications while signed in, so "your task shipped" can reach them.
ALTER TABLE push_subscriptions ADD COLUMN wallet TEXT;
