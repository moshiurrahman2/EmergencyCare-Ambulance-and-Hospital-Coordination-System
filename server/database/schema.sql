CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('patient', 'dispatcher', 'ambulance', 'admin') NOT NULL,
  account_status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_status (role, account_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatcher_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  age TINYINT UNSIGNED NOT NULL,
  permanent_address VARCHAR(500) NOT NULL,
  present_address VARCHAR(500) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  nid_number VARCHAR(64) NOT NULL,
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  approval_reason VARCHAR(500) NULL,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMP NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_dispatcher_approval_status (approval_status),
  CONSTRAINT fk_dispatcher_profile_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_dispatcher_profile_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE dispatcher_profiles
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS ambulance_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  driver_name VARCHAR(120) NOT NULL,
  vehicle_number VARCHAR(32) NOT NULL,
  permanent_address VARCHAR(500) NOT NULL,
  present_address VARCHAR(500) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  nid_number VARCHAR(64) NOT NULL,
  driving_licence_number VARCHAR(64) NOT NULL,
  nid_photo_path VARCHAR(500) NULL,
  licence_photo_path VARCHAR(500) NULL,
  approval_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  approval_reason VARCHAR(500) NULL,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_ambulance_vehicle_number (vehicle_number),
  KEY idx_ambulance_availability (approval_status, is_online),
  CONSTRAINT fk_ambulance_profile_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_ambulance_profile_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ambulance_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id BIGINT UNSIGNED NOT NULL,
  dispatcher_id BIGINT UNSIGNED NULL,
  ambulance_id BIGINT UNSIGNED NULL,
  patient_name VARCHAR(120) NOT NULL,
  patient_phone VARCHAR(32) NOT NULL,
  symptoms TEXT NOT NULL,
  current_location VARCHAR(500) NOT NULL,
  current_latitude DECIMAL(10, 7) NOT NULL,
  current_longitude DECIMAL(10, 7) NOT NULL,
  destination VARCHAR(500) NOT NULL,
  destination_latitude DECIMAL(10, 7) NULL,
  destination_longitude DECIMAL(10, 7) NULL,
  ambulance_type ENUM('basic', 'icu', 'freezer') NOT NULL,
  estimated_distance_km DECIMAL(8, 2) NULL,
  fare_rate_per_km DECIMAL(10, 2) NULL,
  fare_amount DECIMAL(10, 2) NULL,
  payment_method ENUM('cash') NOT NULL DEFAULT 'cash',
  payment_status ENUM('not_required', 'pending', 'paid') NOT NULL DEFAULT 'not_required',
  cash_collected_at TIMESTAMP NULL,
  status ENUM(
    'searching',
    'requested_to_ambulance',
    'accepted',
    'picked_up',
    'at_hospital',
    'completed',
    'cancelled'
  ) NOT NULL DEFAULT 'searching',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_request_status_created (status, created_at),
  KEY idx_request_patient_created (patient_id, created_at),
  KEY idx_request_dispatcher_status (dispatcher_id, status),
  KEY idx_request_ambulance_status (ambulance_id, status),
  CONSTRAINT fk_request_patient
    FOREIGN KEY (patient_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_request_dispatcher
    FOREIGN KEY (dispatcher_id) REFERENCES dispatcher_profiles (user_id) ON DELETE SET NULL,
  CONSTRAINT fk_request_ambulance
    FOREIGN KEY (ambulance_id) REFERENCES ambulance_profiles (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ambulance_requests
  ADD COLUMN IF NOT EXISTS estimated_distance_km DECIMAL(8, 2) NULL,
  ADD COLUMN IF NOT EXISTS fare_rate_per_km DECIMAL(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS fare_amount DECIMAL(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS payment_method ENUM('cash') NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_status ENUM('not_required', 'pending', 'paid') NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS cash_collected_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS fare_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  basic_per_km DECIMAL(10, 2) NOT NULL,
  icu_per_km DECIMAL(10, 2) NOT NULL,
  freezer_per_km DECIMAL(10, 2) NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_fare_settings_admin
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO fare_settings (id, basic_per_km, icu_per_km, freezer_per_km)
VALUES (1, 60.00, 80.00, 100.00)
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS ambulance_locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ambulance_id BIGINT UNSIGNED NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ambulance_location_recent (ambulance_id, recorded_at),
  CONSTRAINT fk_location_ambulance
    FOREIGN KEY (ambulance_id) REFERENCES ambulance_profiles (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ambulance_request_responses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  ambulance_id BIGINT UNSIGNED NOT NULL,
  response ENUM('accepted', 'declined') NOT NULL,
  responded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_request_response_ambulance (request_id, ambulance_id),
  KEY idx_ambulance_response_recent (ambulance_id, responded_at),
  CONSTRAINT fk_request_response_request
    FOREIGN KEY (request_id) REFERENCES ambulance_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_request_response_ambulance
    FOREIGN KEY (ambulance_id) REFERENCES ambulance_profiles (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  notification_type VARCHAR(40) NOT NULL,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(500) NOT NULL,
  href VARCHAR(500) NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_notifications_unread (user_id, read_at, created_at),
  CONSTRAINT fk_user_notification_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  endpoint TEXT NOT NULL,
  endpoint_hash BINARY(32) NOT NULL,
  p256dh_key VARCHAR(128) NOT NULL,
  auth_key VARCHAR(128) NOT NULL,
  expiration_time BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_subscription_endpoint_hash (endpoint_hash),
  KEY idx_push_subscription_user (user_id),
  CONSTRAINT fk_push_subscription_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
