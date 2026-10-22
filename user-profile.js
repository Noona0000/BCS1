const ACTIVE_PROFILE_KEY = 'bms.active-profile.v1';
const MIGRATION_KEY = 'bms.profile-data-migrated.v1';
const LEGACY_KEYS = [
  'bms.feed-database.v1',
  'bms.mineral-database.v1',
  'bms.nutrient-requirements.v1',
  'bms.mineral-stock.v1',
  'bms.daily-feed-records.v1',
];

export function getActiveProfileId() {
  let profileId = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (!isValidProfileId(profileId)) {
    profileId = createProfileId();
    localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
  }
  migrateLegacyData(profileId);
  return profileId;
}

export function getProfileStorageKey(key) {
  return `bms.users.${getActiveProfileId()}.${key.replace(/^bms\./, '')}`;
}

export function isValidProfileId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

function createProfileId() {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function migrateLegacyData(profileId) {
  if (localStorage.getItem(MIGRATION_KEY)) return;
  for (const legacyKey of LEGACY_KEYS) {
    const scopedKey = `bms.users.${profileId}.${legacyKey.replace(/^bms\./, '')}`;
    if (localStorage.getItem(scopedKey) === null) {
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue !== null) localStorage.setItem(scopedKey, legacyValue);
    }
  }
  localStorage.setItem(MIGRATION_KEY, '1');
}
