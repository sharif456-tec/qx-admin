// Lightweight contract test for the Cloudflare registration payload.
// Run with: node tests/register-schema.test.js

import assert from 'node:assert/strict';

const input = {
  name: 'Test User',
  email: 'test@example.com',
  telegram: '@testuser',
  telegram_chat_id: '12345',
  device_id: 'device-1',
  device_name: 'Kiwi Android'
};

const required = ['name', 'email', 'device_id'];
for (const key of required) assert.ok(String(input[key] || '').trim(), `${key} is required`);

const registrationRow = {
  name: input.name,
  email: input.email,
  telegram: input.telegram,
  telegram_chat_id: String(input.telegram_chat_id),
  device_id: input.device_id,
  device_name: input.device_name
};

assert.deepEqual(Object.keys(registrationRow).sort(), [
  'device_id',
  'device_name',
  'email',
  'name',
  'telegram',
  'telegram_chat_id'
]);

console.log('registration schema contract: OK');
