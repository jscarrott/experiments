import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectCarrier } from '../src/detect/carrier.js';

test('each carrier is recognised from its name', () => {
  assert.equal(detectCarrier('Royal Mail Tracked 48'), 'royal-mail');
  assert.equal(detectCarrier('RoyalMail'), 'royal-mail');
  assert.equal(detectCarrier('Evri Standard Delivery'), 'evri');
  assert.equal(detectCarrier('Hermes Parcelnet'), 'evri');
  assert.equal(detectCarrier('InPost Locker to Locker'), 'inpost');
  assert.equal(detectCarrier('DPD Pickup'), 'dpd');
  assert.equal(detectCarrier('YODEL'), 'yodel');
});

test('nothing recognisable is unknown', () => {
  assert.equal(detectCarrier(''), 'unknown');
  assert.equal(detectCarrier('Thank you for selling on Vinted'), 'unknown');
});

test('a passing mention of another carrier loses to the label owner', () => {
  const text = 'InPost InPost locker label QR. You can also drop off at an Evri ParcelShop. inpost.co.uk';
  assert.equal(detectCarrier(text), 'inpost');
});

test('carrier names inside other words do not count', () => {
  assert.equal(detectCarrier('Thermopolis everything'), 'unknown');
});
