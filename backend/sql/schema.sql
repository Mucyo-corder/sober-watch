CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR NOT NULL,
  alcohol_level DECIMAL NOT NULL,
  status VARCHAR NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  log_id INTEGER REFERENCES logs(id),
  device_id VARCHAR NOT NULL,
  alcohol_level DECIMAL NOT NULL,
  status VARCHAR NOT NULL,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  acknowledged_by VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp_desc ON logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_device_id ON alerts (device_id);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts (acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at DESC);

CREATE TABLE IF NOT EXISTS alerts_history (
  id SERIAL PRIMARY KEY,
  log_id INTEGER,
  device_id VARCHAR NOT NULL,
  alcohol_level DECIMAL NOT NULL,
  status VARCHAR NOT NULL,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  acknowledged_by VARCHAR,
  created_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_history_created_at ON alerts_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_history_device_id ON alerts_history (device_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  user_email VARCHAR,
  action VARCHAR NOT NULL,
  entity_type VARCHAR,
  entity_id INTEGER,
  details TEXT,
  ip_address VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);

-- Device baselines for auto-learning normal alcohol levels per device
CREATE TABLE IF NOT EXISTS device_baselines (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR NOT NULL UNIQUE,
  mean_level DECIMAL NOT NULL DEFAULT 0,
  std_dev DECIMAL NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_reading DECIMAL,
  deviation_threshold DECIMAL NOT NULL DEFAULT 2.0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_baselines_device_id ON device_baselines (device_id);

-- Notification settings for email alerts
CREATE TABLE IF NOT EXISTS notification_settings (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR NOT NULL DEFAULT 'all',
  email VARCHAR NOT NULL,
  alert_types VARCHAR[] NOT NULL DEFAULT '{"WARNING","DANGER"}',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_settings_device_id ON notification_settings (device_id);
CREATE INDEX IF NOT EXISTS idx_notification_settings_email ON notification_settings (email);
