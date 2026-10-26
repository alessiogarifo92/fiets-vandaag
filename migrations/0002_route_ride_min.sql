-- The cron computes the same recommendation as the Today screen, which needs the estimated ride time
-- (src/core/route.ts, minutes in 5-minute steps). Nullable: routes saved before this migration get it on
-- the app's next open, which re-sends the route; until then the cron uses a fallback (src/worker/cron/drain.ts).
ALTER TABLE routes ADD COLUMN ride_min INTEGER CHECK (ride_min IS NULL OR ride_min BETWEEN 1 AND 180);
