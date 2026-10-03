CREATE TABLE IF NOT EXISTS products (id text PRIMARY KEY, name text NOT NULL, version integer NOT NULL DEFAULT 1);
INSERT INTO products VALUES ('1','Demo product',1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS query_stats (id boolean PRIMARY KEY DEFAULT true, count bigint NOT NULL DEFAULT 0);
INSERT INTO query_stats VALUES (true,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS profiles (id text PRIMARY KEY, bio text NOT NULL, version integer NOT NULL DEFAULT 1);
INSERT INTO profiles VALUES ('user_1','Initial bio',1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY, balance bigint NOT NULL DEFAULT 0);
INSERT INTO accounts VALUES ('demo',0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS processed_messages (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE SEQUENCE IF NOT EXISTS fencing_seq;
CREATE TABLE IF NOT EXISTS lock_inventory (id text PRIMARY KEY, stock integer NOT NULL CHECK(stock>=0), fence bigint NOT NULL DEFAULT 0);
INSERT INTO lock_inventory VALUES ('demo',50,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL);
CREATE TABLE IF NOT EXISTS routing (id boolean PRIMARY KEY DEFAULT true, nodes jsonb NOT NULL, version integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'ACTIVE');
INSERT INTO routing VALUES (true,'["shard1","shard2","shard3"]',1,'ACTIVE') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sales (id text PRIMARY KEY, initial_stock integer NOT NULL CHECK(initial_stock>=0), stock integer NOT NULL CHECK(stock>=0), CHECK(stock<=initial_stock));
INSERT INTO sales VALUES ('ticket_vip_blackpink',50,50) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS orders (
 id uuid PRIMARY KEY, sale_id text NOT NULL REFERENCES sales(id), user_id text NOT NULL,
 quantity integer NOT NULL CHECK(quantity=1), status text NOT NULL CHECK(status IN ('PENDING_PAYMENT','PAID','CANCELLED')),
 idempotency_key text NOT NULL UNIQUE, request_hash text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(sale_id,user_id)
);
CREATE TABLE IF NOT EXISTS outbox (
 id uuid PRIMARY KEY, aggregate_id text NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSED')),
 created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(created_at) WHERE status='PENDING';
CREATE TABLE IF NOT EXISTS deliveries (event_id uuid PRIMARY KEY, order_id text NOT NULL, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS requests (key text PRIMARY KEY, hash text NOT NULL, order_id uuid REFERENCES orders(id));
CREATE TABLE IF NOT EXISTS foundation_items (id integer PRIMARY KEY, category integer NOT NULL, payload text NOT NULL);
INSERT INTO foundation_items SELECT n,n%100,repeat('x',100) FROM generate_series(1,20000) n ON CONFLICT DO NOTHING;
