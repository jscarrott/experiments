import type { NOTE_COLLECTION } from './nsid.js';

/** The `community.lexicon.location.geo` shape. Note the coordinates are STRINGS. */
export interface GeoLocation {
  $type?: 'community.lexicon.location.geo';
  latitude: string;
  longitude: string;
  altitude?: string;
  name?: string;
}

/** The `#osmPlace` def from the note lexicon. */
export interface OsmPlace {
  osmType: 'node' | 'way' | 'relation';
  /** String, not number: OSM ids are past 2^32 and heading for 2^53. */
  osmId: string;
  name?: string;
  /** The primary OSM tag, e.g. `amenity=cafe`. */
  category?: string;
}

/** A note record, as it sits in a repo. */
export interface NoteRecord {
  $type?: typeof NOTE_COLLECTION;
  text: string;
  location: GeoLocation;
  place?: OsmPlace;
  rating?: number;
  tags?: string[];
  createdAt: string;
}

/**
 * A note after sync: the record, plus who wrote it and where it lives, plus the
 * coordinates parsed once into numbers so filtering never re-parses.
 */
export interface Note {
  uri: string;
  cid: string;
  /** DID of the member who wrote it. */
  author: string;
  record: NoteRecord;
  lat: number;
  lng: number;
  /** `node/123456`, or undefined when the note isn't about a mapped feature. */
  placeKey?: string;
  /** Milliseconds since epoch, from createdAt. Sorting key. */
  createdAtMs: number;
}

/** A business, as gathered from the notes that reference it. */
export interface PlaceGroup {
  key: string;
  place: OsmPlace;
  notes: Note[];
  lat: number;
  lng: number;
  /** Mean of the ratings that exist, or undefined if nobody rated it. */
  averageRating?: number;
  ratingCount: number;
}

/** A candidate business offered when composing, from tiles or from Overpass. */
export interface PlaceCandidate {
  osmType?: 'node' | 'way' | 'relation';
  osmId?: string;
  name: string;
  category?: string;
  lat: number;
  lng: number;
  /** Metres from the point asked about, when known. */
  distance?: number;
}
