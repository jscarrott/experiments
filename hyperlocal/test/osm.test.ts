import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RADIUS_M,
  overpassQuery,
  parseOverpass,
  parsePhoton,
  photonUrl,
  primaryCategory,
} from '../place-proxy/osm.js';

test('the Overpass query asks for nodes, ways and relations with names', () => {
  const q = overpassQuery(51.5074, -0.1278);
  assert.ok(q.includes(`nwr(around:${DEFAULT_RADIUS_M},51.5074,-0.1278)["amenity"]["name"];`));
  assert.ok(q.includes('["shop"]'));
  // `out center` is what gives ways and relations a single coordinate.
  assert.ok(q.includes('out center tags;'));
  assert.ok(!q.includes('["highway"]'), 'street segments would bury the businesses');
});

test('parses nodes and centred ways, nearest first', () => {
  const body = {
    elements: [
      { type: 'way', id: 222, center: { lat: 51.5084, lon: -0.1278 }, tags: { name: 'Far Pub', amenity: 'pub' } },
      { type: 'node', id: 111, lat: 51.5074, lon: -0.1278, tags: { name: 'Near Café', amenity: 'cafe' } },
    ],
  };
  const found = parseOverpass(body, 51.5074, -0.1278);
  assert.deepEqual(found.map((c) => c.name), ['Near Café', 'Far Pub']);
  assert.deepEqual(found[0], {
    osmType: 'node',
    osmId: '111',
    name: 'Near Café',
    lat: 51.5074,
    lng: -0.1278,
    distance: 0,
    category: 'amenity=cafe',
  });
  assert.equal(found[1].osmType, 'way');
  assert.ok(found[1].distance! > 100);
});

test('drops elements that cannot be attached to a note', () => {
  const body = {
    elements: [
      { type: 'node', id: 1, lat: 51.5, lon: -0.1, tags: { amenity: 'cafe' } }, // unnamed
      { type: 'node', id: 2, tags: { name: 'No coords', amenity: 'cafe' } },
      { type: 'area', id: 3, lat: 51.5, lon: -0.1, tags: { name: 'Area', amenity: 'cafe' } },
      { type: 'node', id: 'abc', lat: 51.5, lon: -0.1, tags: { name: 'Bad id' } },
    ],
  };
  assert.deepEqual(parseOverpass(body, 51.5, -0.1), []);
});

test('survives a response that is not shaped like Overpass at all', () => {
  assert.deepEqual(parseOverpass(null, 0, 0), []);
  assert.deepEqual(parseOverpass({}, 0, 0), []);
  assert.deepEqual(parseOverpass({ elements: 'nope' }, 0, 0), []);
  assert.deepEqual(parseOverpass('<html>429</html>', 0, 0), []);
});

test('keeps large OSM ids exact by carrying them as strings', () => {
  const body = {
    elements: [
      { type: 'node', id: 12345678901234, lat: 51.5, lon: -0.1, tags: { name: 'Big', shop: 'bakery' } },
    ],
  };
  assert.equal(parseOverpass(body, 51.5, -0.1)[0].osmId, '12345678901234');
});

test('deduplicates a feature matched by more than one tag clause', () => {
  const el = { type: 'node', id: 7, lat: 51.5, lon: -0.1, tags: { name: 'Both', amenity: 'cafe', shop: 'bakery' } };
  assert.equal(parseOverpass({ elements: [el, el] }, 51.5, -0.1).length, 1);
});

test('the category is the first recognised place tag', () => {
  assert.equal(primaryCategory({ amenity: 'cafe', shop: 'bakery' }), 'amenity=cafe');
  assert.equal(primaryCategory({ shop: 'bakery' }), 'shop=bakery');
  assert.equal(primaryCategory({ building: 'yes' }), undefined);
  assert.equal(primaryCategory({ amenity: 'no' }), undefined);
  assert.equal(primaryCategory({}), undefined);
});

test('the Photon URL biases to the map centre', () => {
  const url = new URL(photonUrl('crown', 51.5, -0.12));
  assert.equal(url.host, 'photon.komoot.io');
  assert.equal(url.searchParams.get('q'), 'crown');
  assert.equal(url.searchParams.get('lat'), '51.5');
  assert.equal(url.searchParams.get('lon'), '-0.12');
  assert.equal(new URL(photonUrl('crown')).searchParams.get('lat'), null);
});

test('parses Photon GeoJSON, reading coordinates as [lng, lat]', () => {
  const body = {
    features: [
      {
        geometry: { coordinates: [-0.1278, 51.5074] },
        properties: { name: 'The Crown', osm_type: 'W', osm_id: 987654321, osm_key: 'amenity', osm_value: 'pub' },
      },
    ],
  };
  assert.deepEqual(parsePhoton(body), [
    {
      name: 'The Crown',
      lat: 51.5074,
      lng: -0.1278,
      osmType: 'way',
      osmId: '987654321',
      category: 'amenity=pub',
    },
  ]);
});

test('keeps a Photon result that has a name but no usable OSM id', () => {
  // Still useful: it can position the map, it just cannot group notes.
  const found = parsePhoton({
    features: [{ geometry: { coordinates: [-0.1, 51.5] }, properties: { name: 'Somewhere' } }],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].osmId, undefined);
});

test('drops Photon features with no name or broken geometry', () => {
  assert.deepEqual(
    parsePhoton({
      features: [
        { geometry: { coordinates: [-0.1, 51.5] }, properties: {} },
        { geometry: { coordinates: [-0.1] }, properties: { name: 'Short' } },
        { properties: { name: 'No geometry' } },
      ],
    }),
    [],
  );
  assert.deepEqual(parsePhoton(undefined), []);
});
